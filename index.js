// index.js (최종 통합 수정 버전)

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors'); // CORS 미들웨어 사용
const nodemailer = require('nodemailer'); 
const xlsx = require('xlsx'); 

const Survey = require('./models/Survey');
const Response = require('./models/Response');

const app = express();
const PORT = 5000;

// --- 1. 기본 설정 (Middleware) ---
// 🚨 CORS 문제 해결: Netlify 주소만 허용하도록 변경 
const corsOptions = {
    // ⚠️ Netlify 임시 도메인으로 변경해야 합니다.
    origin: 'https://resilient-mandazi-b3d16e.netlify.app', 
    credentials: true,
};
app.use(cors(corsOptions)); // ◀ 옵션을 적용하여 CORS 미들웨어 사용

app.use(bodyParser.json());

// --- 2. MongoDB 데이터베이스 연결 ---
const dbURI = process.env.MONGODB_URI; 

mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB 연결 성공'))
    .catch((err) => console.error('❌ MongoDB 연결 실패:', err));

// --- 3. Nodemailer (Naver SMTP 설정) ---
// ⚠️ 이메일 오류 해결: Naver SMTP로 전환하고 포트 명시
const transporter = nodemailer.createTransport({
    host: 'smtp.naver.com', // ◀ Naver 서버 주소
    port: 465,              
    secure: true,           
    auth: {
        user: process.env.GMAIL_USER, // Render 환경 변수에서 Naver ID를 가져옴
        pass: process.env.GMAIL_PASS  // Render 환경 변수에서 Naver PW/앱 비밀번호를 가져옴
    }
});


// --- 4. API 라우트(Routes) 정의 (나머지 코드는 변경 없음) ---

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


/* 엑셀/이메일 전송 API */
app.get('/api/surveys/:id/export', async (req, res) => {
    try {
        const surveyId = req.params.id;
        const survey = await Survey.findById(surveyId);
        if (!survey) { return res.status(404).json({ message: '설문지를 찾을 수 없습니다.' }); }

        const responses = await Response.find({ surveyId: surveyId }).sort({ submittedAt: 1 });
        if (responses.length === 0) { return res.status(400).json({ message: '이 설문지에는 아직 응답이 없습니다.' }); }

        // 엑셀 생성 로직...
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
        xlsx.utils.book_append_sheet(wb, ws, '설문응답');
        const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // 이메일 전송
        await transporter.sendMail({
            from: process.env.GMAIL_USER, 
            to: process.env.RECEIVE_EMAIL, 
            subject: `[${survey.title}] 설문조사 결과 보고서`, 
            text: `총 ${responses.length}개의 응답 결과를 엑셀 파일로 첨부합니다.`,
            attachments: [
                {
                    filename: `${survey.title}_${Date.now()}.xlsx`,
                    content: excelBuffer, 
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
            ]
        });

        console.log('✅ 이메일 전송 성공!');
        res.status(200).json({ message: '엑셀 보고서가 이메일로 성공적으로 전송되었습니다.' });

    } catch (error) {
        console.error('🔥 엑셀/이메일 전송 오류:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.', error });
    }
});


// --- 5. 서버 시작 ---
app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});