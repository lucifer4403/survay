// index.js (최종 버전: 관리자 로그인, CORS 해결, 텔레그램 전송 통합)

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors'); 
const xlsx = require('xlsx'); 
const axios = require('axios');
const FormData = require('form-data'); 
const jwt = require('jsonwebtoken'); // 💡 JWT 라이브러리 추가

const Survey = require('./models/Survey');
const Response = require('./models/Response');

const app = express();
const PORT = 5000;

// Render 환경 변수 로드 (없으면 기본값 사용)
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'your_super_secret_key_for_jwt';

// --- 1. 기본 설정 (Middleware) ---
// 🚨 CORS 문제 최종 해결: 모든 도메인에서의 접근을 무조건 허용합니다.
app.use(cors()); 
app.use(bodyParser.json());

// 💡 필수: Render 서버가 HTML 파일(정적 파일)을 제공하도록 설정
// 이 설정으로 Render에서도 admin.html과 index.html을 찾을 수 있게 됩니다.
app.use(express.static('.')); 

// --- 2. MongoDB 데이터베이스 연결 ---
const dbURI = process.env.MONGODB_URI; 

mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB 연결 성공'))
    .catch((err) => console.error('❌ MongoDB 연결 실패:', err));


// --- 3. 인증 미들웨어 (Authentication Middleware) ---
// 관리자 토큰의 유효성을 검사합니다.
const isAuthenticated = (req, res, next) => {
    // 1. 헤더에서 토큰 추출 (Bearer 스키마 제거)
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ message: '접근 권한이 없습니다. (로그인 필요)' });
    }

    try {
        // 2. 토큰 검증
        const decoded = jwt.verify(token, ADMIN_SECRET);
        req.user = decoded; 
        next(); // 인증 성공: 다음 라우트 함수 실행
    } catch (err) {
        // 토큰 만료 또는 위변조
        return res.status(401).json({ message: '접근 권한이 유효하지 않습니다. 다시 로그인해 주세요.' });
    }
};


// --- 4. API 라우트(Routes) 정의 ---

// 💡 새로운 라우트: 관리자 로그인
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    const ADMIN_USER = process.env.ADMIN_USER;
    const ADMIN_PASS = process.env.ADMIN_PASS;

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        // 인증 성공: 1시간 유효 기간 토큰 생성
        const token = jwt.sign({ username: ADMIN_USER }, ADMIN_SECRET, { expiresIn: '1h' });
        return res.json({ message: '로그인 성공', token: token });
    } else {
        return res.status(401).json({ message: '아이디 또는 비밀번호가 일치하지 않습니다.' });
    }
});


// ----------------------------------------------------------------------
// 🚨 관리자 API: 모두 isAuthenticated 미들웨어 적용 (보안)
// ----------------------------------------------------------------------

// 1. 설문지 생성
app.post('/api/surveys', isAuthenticated, async (req, res) => {
    try {
        const newSurvey = new Survey(req.body);
        const savedSurvey = await newSurvey.save();
        res.status(201).json(savedSurvey);
    } catch (error) {
        console.error('설문지 생성 오류:', error);
        res.status(500).json({ message: '설문지 생성에 실패했습니다.', error: error.message });
    }
});

// 2. 모든 설문지 목록 조회
app.get('/api/surveys', isAuthenticated, async (req, res) => {
    try {
        const surveys = await Survey.find().sort({ createdAt: -1 });
        res.json(surveys);
    } catch (error) {
        res.status(500).json({ message: '설문지 목록을 가져오는 데 실패했습니다.' });
    }
});

// 3. 설문지 삭제
app.delete('/api/surveys/:id', isAuthenticated, async (req, res) => {
    try {
        const surveyId = req.params.id;
        // 관련 응답 먼저 삭제
        await Response.deleteMany({ surveyId: surveyId }); 
        // 설문지 삭제
        const result = await Survey.findByIdAndDelete(surveyId);
        
        if (!result) { return res.status(404).json({ message: '설문지를 찾을 수 없습니다.' }); }
        
        res.json({ message: `[${result.title}] 설문지와 관련 응답이 성공적으로 삭제되었습니다.` });
    } catch (error) {
        res.status(500).json({ message: '설문지 삭제에 실패했습니다.' });
    }
});


// 4. 텔레그램 엑셀 전송
app.get('/api/surveys/:id/export', isAuthenticated, async (req, res) => {
    try {
        const surveyId = req.params.id;
        const survey = await Survey.findById(surveyId);
        if (!survey) { return res.status(404).json({ message: '설문지를 찾을 수 없습니다.' }); }

        const responses = await Response.find({ surveyId: surveyId }).sort({ submittedAt: 1 });
        if (responses.length === 0) { return res.status(400).json({ message: '이 설문지에는 아직 응답이 없습니다.' }); }

        // 엑셀 생성 로직... (이전 코드와 동일)
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
        
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', excelBuffer, { 
            filename: filename, 
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
        });
        formData.append('caption', captionText);
        
        await axios.post(`https://api.telegram.org/bot${telegramToken}/sendDocument`, formData, {
            headers: formData.getHeaders()
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


// ----------------------------------------------------------------------
// 🌐 사용자 API: 인증 미들웨어 적용 안 함 (모두 접근 가능)
// ----------------------------------------------------------------------

// 5. 특정 설문지 1개 조회 (사용자 페이지 로드용)
app.get('/api/surveys/:id', async (req, res) => {
    try {
        const survey = await Survey.findById(req.params.id);
        if (!survey) {
            return res.status(404).json({ message: '설문지를 찾을 수 없습니다.' });
        }
        res.json(survey);
    } catch (error) {
        res.status(500).json({ message: '설문지 정보를 가져오는 데 실패했습니다.' });
    }
});

// 6. 설문 응답 제출
app.post('/api/responses', async (req, res) => {
    try {
        const { surveyId, name, phone, answers } = req.body;
        
        // 중복 응답 체크 (전화번호 기준)
        const existingResponse = await Response.findOne({ surveyId, phone });
        if (existingResponse) {
            return res.status(409).json({ message: '이미 이 설문에 참여한 전화번호입니다.' });
        }

        const newResponse = new Response({ surveyId, name, phone, answers });
        await newResponse.save();
        
        res.status(201).json({ message: '소중한 의견 감사합니다. 응답이 성공적으로 제출되었습니다.' });

    } catch (error) {
        console.error('응답 제출 오류:', error);
        res.status(500).json({ message: '응답 제출에 실패했습니다.' });
    }
});


// --- 5. 서버 시작 ---
app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});