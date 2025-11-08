// index.js (최종 수정 버전: 이메일 제거, 텔레그램 파일 직접 전송)

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors'); 
const xlsx = require('xlsx'); 
const axios = require('axios'); // 💡 Telegram 연동을 위한 axios 유지

const Survey = require('./models/Survey');
const Response = require('./models/Response');

const app = express();
const PORT = 5000;

// --- 1. 기본 설정 (Middleware) ---
app.use(cors()); 
app.use(bodyParser.json());

// --- 2. MongoDB 데이터베이스 연결 ---
// MONGODB_URI는 .env 파일에서 불러옵니다.
const dbURI = process.env.MONGODB_URI; 

mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB 연결 성공'))
    .catch((err) => console.error('❌ MongoDB 연결 실패:', err));

// --- 3. Nodemailer 설정은 완전히 제거되었습니다. ---


// --- 4. API 라우트(Routes) 정의 ---

/* (테스트용) */
app.get('/api/test', (req, res) => {
    res.json({ message: '👋 survey-app 백엔드 서버가 동작 중입니다!' });
});

/* (C) 새 설문지 생성 */
app.post('/api/surveys', async (req, res) => {
    try {
        const { title, description, questions } = req.body;
        const newSurvey = new Survey({ title, description, questions });
        const savedSurvey = await newSurvey.save();
        console.log('📝 새 설문지 저장 완료:', savedSurvey.title);
        res.status(201).json(savedSurvey);
    } catch (error) {
        console.error('🔥 설문지 저장 오류:', error);
        res.status(500).json({ message: '서버 오류', error });
    }
});

/* (R) 모든 설문지 목록 조회 */
app.get('/api/surveys', async (req, res) => {
    try {
        const surveys = await Survey.find({}, '-questions').sort({ createdAt: -1 });
        res.status(200).json(surveys);
    } catch (error) {
        console.error('🔥 설문지 목록 조회 오류:', error);
        res.status(500).json({ message: '서버 오류', error });
    }
});

/* (U) 특정 설문지 수정 */
app.put('/api/surveys/:id', async (req, res) => {
    try {
        const { title, description, questions } = req.body;
        const updatedSurvey = await Survey.findByIdAndUpdate(
            req.params.id,
            { title, description, questions },
            { new: true, runValidators: true } 
        );
        if (!updatedSurvey) {
            return res.status(404).json({ message: '수정할 설문지를 찾을 수 없습니다.' });
        }
        console.log('🔄 설문지 수정 완료:', updatedSurvey.title);
        res.status(200).json(updatedSurvey);
    } catch (error) {
        console.error('🔥 설문지 수정 오류:', error);
        res.status(500).json({ message: '서버 오류', error });
    }
});

/* (D) 특정 설문지 삭제 */
app.delete('/api/surveys/:id', async (req, res) => {
    try {
        const deletedSurvey = await Survey.findByIdAndDelete(req.params.id);
        if (!deletedSurvey) {
            return res.status(404).json({ message: '삭제할 설문지를 찾을 수 없습니다.' });
        }
        await Response.deleteMany({ surveyId: req.params.id });
        console.log(`🗑️ 설문지 삭제 완료: ${deletedSurvey.title}`);
        res.status(200).json({ message: '설문지가 성공적으로 삭제되었습니다.' });
    } catch (error) {
        console.error('🔥 설문지 삭제 오류:', error);
        res.status(500).json({ message: '서버 오류', error });
    }
});

/* (R) 특정 설문지 1개 조회 */
app.get('/api/surveys/:id', async (req, res) => {
    try {
        const survey = await Survey.findById(req.params.id);
        if (!survey) {
            return res.status(404).json({ message: '설문지를 찾을 수 없습니다.' });
        }
        res.status(200).json(survey);
    } catch (error) {
        console.error('🔥 특정 설문지 조회 오류:', error);
        if (error.kind === 'ObjectId') {
             return res.status(400).json({ message: '잘못된 ID 형식입니다.' });
        }
        res.status(500).json({ message: '서버 오류', error });
    }
});

/* (C) 설문 응답 제출 */
app.post('/api/responses', async (req, res) => {
    try {
        const { surveyId, name, phone, answers } = req.body;
        const surveyExists = await Survey.findById(surveyId);
        if (!surveyExists) {
            return res.status(404).json({ message: '존재하지 않는 설문지 ID입니다.' });
        }
        const newResponse = new Response({ surveyId, name, phone, answers });
        await newResponse.save();
        console.log(`✅ 새 응답 저장 완료 (Survey: ${surveyId}, User: ${name})`);
        res.status(201).json({ message: '설문 응답이 성공적으로 제출되었습니다.' });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: '이미 이 전화번호로 참여한 설문입니다.' });
        }
        console.error('🔥 응답 저장 오류:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.', error });
    }
});


/* 엑셀/텔레그램 전송 API (최종 수정: 텔레그램 파일 직접 전송) */
app.get('/api/surveys/:id/export', async (req, res) => {
    try {
        const surveyId = req.params.id;
        const survey = await Survey.findById(surveyId);
        if (!survey) { return res.status(404).json({ message: '설문지를 찾을 수 없습니다.' }); }

        const responses = await Response.find({ surveyId: surveyId }).sort({ submittedAt: 1 });
        if (responses.length === 0) { return res.status(400).json({ message: '이 설문지에는 아직 응답이 없습니다.' }); }

        // 엑셀 생성 로직 (이전과 동일)...
        const headers = ['제출 시간', '이름', '전화번호', ...survey.questions.map(q => q.text)];
        const data = [headers]; 
        for (const response of responses) {
            const row = [ 
                response.submittedAt.toLocaleString('ko-KR'),
                response.name,    
                response.phone    
            ];                  
            for (const question of survey.questions) {
                const answer = response.answers.find(a => a.questionText === question.text);
                row.push(answer ? answer.value : '(무응답)');
            }
            data.push(row);
        }
        const ws = xlsx.utils.aoa_to_sheet(data); 
        const wb = xlsx.utils.book_new();
        const filename = `${survey.title}_${Date.now()}.xlsx`;
        xlsx.utils.book_append_sheet(wb, ws, '설문응답');
        const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });


        // 💡 텔레그램으로 엑셀 파일 직접 전송
        const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        const captionText = `🔔 설문 응답 보고서: [${survey.title}]\n총 ${responses.length}개의 응답이 접수되었습니다.`;

        if (!telegramToken || !chatId) {
             return res.status(500).json({ 
                message: '텔레그램 환경 변수(TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID)를 .env 파일에 반드시 설정해야 합니다.' 
             });
        }
        
        // Form Data를 사용하여 엑셀 파일 전송 준비
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
        formData.append('caption', captionText);
        
        // 텔레그램 sendDocument API 호출
        await axios.post(`https://api.telegram.org/bot${telegramToken}/sendDocument`, formData, {
            headers: {
                ...formData.getHeaders() // Form Data 헤더 설정
            }
        });

        console.log('✅ 텔레그램으로 엑셀 파일 전송 성공!');
        res.status(200).json({ message: '엑셀 보고서가 텔레그램으로 성공적으로 전송되었습니다.' });

    } catch (error) {
        console.error('🔥 엑셀/텔레그램 전송 오류:', error.response ? error.response.data : error.message);
        res.status(500).json({ 
            message: '서버 오류가 발생했습니다. 텔레그램 토큰, 채팅 ID, 또는 봇의 권한을 확인하세요.', 
            error: error.response ? error.response.data : error.message 
        });
    }
});


// --- 5. 서버 시작 ---
app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});