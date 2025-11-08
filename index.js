// index.js (최종 안정화 버전: 텔레그램 알림 충돌 방지)

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors'); 
const xlsx = require('xlsx'); 
const axios = require('axios');
const FormData = require('form-data'); 
const jwt = require('jsonwebtoken'); 

const Survey = require('./models/Survey');
const Response = require('./models/Response');

const app = express();
const PORT = 5000;

// Render 환경 변수 로드 (없으면 기본값 사용)
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'your_super_secret_key_for_jwt';

// --- 1. 기본 설정 (Middleware) ---
app.use(cors()); 
app.use(bodyParser.json());
app.use(express.static('.')); 

// --- 2. MongoDB 데이터베이스 연결 ---
const dbURI = process.env.MONGODB_URI; 

mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB 연결 성공'))
    .catch((err) => console.error('❌ MongoDB 연결 실패:', err));


// --- 3. 인증 미들웨어 (Authentication Middleware) ---
const isAuthenticated = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ message: '접근 권한이 없습니다. (로그인 필요)' });
    }

    try {
        const decoded = jwt.verify(token, ADMIN_SECRET);
        req.user = decoded; 
        next(); 
    } catch (err) {
        return res.status(401).json({ message: '접근 권한이 유효하지 않습니다. 다시 로그인해 주세요.' });
    }
};

// 💡 텔레그램 알림 함수: 실패해도 서버 충돌 방지 (안정화)
async function sendTelegramAlert(message) {
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!telegramToken || !chatId) {
        console.warn("⚠️ 텔레그램 알림 환경 변수가 설정되지 않았습니다.");
        return; 
    }

    try {
        // 비동기 통신 시도
        await axios.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        // 실패 시 로그만 남기고 서버를 멈추지 않음 (핵심 안정화 로직)
        console.error("🔥 텔레그램 알림 전송 실패:", error.response ? error.response.data : error.message);
    }
}


// --- 4. API 라우트(Routes) 정의 ---

// 💡 관리자 로그인 라우트 (변경 없음)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const ADMIN_USER = process.env.ADMIN_USER;
    const ADMIN_PASS = process.env.ADMIN_PASS;

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = jwt.sign({ username: ADMIN_USER }, ADMIN_SECRET, { expiresIn: '1h' });
        return res.json({ message: '로그인 성공', token: token });
    } else {
        return res.status(401).json({ message: '아이디 또는 비밀번호가 일치하지 않습니다.' });
    }
});

// 💡 최신 설문지 ID 조회 (변경 없음)
app.get('/api/latest-survey', async (req, res) => {
    try {
        const latestSurvey = await Survey.findOne({})
            .sort({ createdAt: -1 })
            .limit(1);

        if (!latestSurvey) { return res.status(404).json({ message: '아직 생성된 설문지가 없습니다.' }); }
        res.json({ surveyId: latestSurvey._id });
    } catch (error) {
        res.status(500).json({ message: '최신 설문지 ID 조회 실패' });
    }
});


// ----------------------------------------------------------------------
// 🌐 사용자 API (응답 제출 시 텔레그램 알림 안정화)
// ----------------------------------------------------------------------

// 💡 설문 응답 제출 (가장 중요한 수정 지점)
app.post('/api/responses', async (req, res) => {
    try {
        const { surveyId, name, phone, answers } = req.body;
        
        const existingResponse = await Response.findOne({ surveyId, phone });
        if (existingResponse) {
            return res.status(409).json({ message: '이미 이 설문에 참여한 전화번호입니다.' });
        }

        const newResponse = new Response({ surveyId, name, phone, answers });
        await newResponse.save();
        
        // 🚨 텔레그램 알림 로직: await를 제거하고 .catch를 사용하여 비동기 처리
        // 응답 전송 실패가 사용자 응답을 막지 않도록 서버 전체를 try...catch 블록으로 감싸지 않음
        
        const submissionTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        const alertMessage = `
🔔 *새 설문 응답 도착!* 🔔
- *응답자:* ${name} (\`${phone}\`)
- *제출 시각:* ${submissionTime}
- *응답 요약:* ${answers[0] ? answers[0].questionText + ': ' + answers[0].value : '(응답 없음)'}
`;
        // 🚨 await 제거 및 .then/.catch 사용: 알림 전송이 사용자 응답을 지연시키지 않음
        sendTelegramAlert(alertMessage).catch(err => console.error("알림 실패 로그:", err.message)); 
        
        // 사용자에게 즉시 성공 응답을 보냄
        res.status(201).json({ message: '소중한 의견 감사합니다. 응답이 성공적으로 제출되었습니다.' });

    } catch (error) {
        // DB 저장 실패 등 치명적인 에러만 여기서 처리
        console.error('응답 제출 오류:', error);
        res.status(500).json({ message: '응답 제출에 실패했습니다.' });
    }
});


// ----------------------------------------------------------------------
// 🚨 관리자 API: (인증 필요) - 이메일 전송 기능도 안정화
// ----------------------------------------------------------------------

// 💡 텔레그램 엑셀 전송
app.get('/api/surveys/:id/export', isAuthenticated, async (req, res) => {
    try {
        const survey = await Survey.findById(req.params.id);
        const responses = await Response.find({ surveyId: req.params.id }).sort({ submittedAt: 1 });
        if (!responses.length) { 
            // 💡 응답이 없을 때 서버 충돌 대신 에러 메시지 반환 (안정화)
            return res.status(400).json({ message: '이 설문지에는 아직 응답이 없어 엑셀을 생성할 수 없습니다.' }); 
        }
        
        // 엑셀 생성 로직 (생략)
        const headers = ['제출 시간', '이름', '전화번호', ...survey.questions.map(q => q.text)];
        const data = [headers]; // ... (엑셀 생성 로직)
        const excelBuffer = xlsx.write(xlsx.utils.book_new(), { type: 'buffer', bookType: 'xlsx' });
        
        const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        
        // 텔레그램 토큰 누락 시 서버 충돌 방지
        if (!telegramToken || !chatId) {
             return res.status(500).json({ message: '텔레그램 환경 변수를 설정해야 합니다.' });
        }

        const formData = new FormData();
        // ... (텔레그램 파일 전송 로직 유지) ...
        
        await axios.post(`https://api.telegram.org/bot${telegramToken}/sendDocument`, formData, {
            headers: formData.getHeaders()
        });
        
        res.status(200).json({ message: '엑셀 보고서가 텔레그램으로 성공적으로 전송되었습니다.' });

    } catch (error) {
        console.error('🔥 엑셀/텔레그램 전송 오류:', error.response ? error.response.data : error.message);
        res.status(500).json({ 
            message: '서버 오류가 발생했습니다. 텔레그램 토큰, 채팅 ID, 또는 봇의 권한을 확인하세요.', 
            error: error.response ? error.response.data : error.message 
        });
    }
});


// ... (다른 API 코드는 최종 버전에서 유지) ...


// --- 5. 서버 시작 ---
app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});