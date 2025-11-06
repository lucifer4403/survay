// index.js (3단계 수정본 - 중복체크, 삭제, 수정 기능 추가)

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

const nodemailer = require('nodemailer'); 
const xlsx = require('xlsx'); 

const Survey = require('./models/Survey');
const Response = require('./models/Response'); // (1단계에서 수정된 모델)

// Express 앱 생성
const app = express();
const PORT = 5000;

// --- 1. 기본 설정 (Middleware) ---
app.use(cors());
app.use(bodyParser.json());

// --- 2. MongoDB 데이터베이스 연결 ---
const dbURI = "mongodb+srv://lucifer:dkflfkd12%40@cluster0.75hkz7j.mongodb.net/?appName=Cluster0";

mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB 연결 성공'))
    .catch((err) => console.error('❌ MongoDB 연결 실패:', err));

// --- 3. Nodemailer (이메일 발송기) 설정 ---
// (이전 단계에서 설정한 본인 G메일 정보)
const transporter = nodemailer.createTransport({
    service: 'gmail', 
    auth: {
        user: 'ds20250829@gmail.com', // ◀= 본인 G메일 주소
        pass: 'qvtgglxueoftlshw'              // ◀= 본인 G메일 앱 비밀번호
    }
});


// --- 4. API 라우트(Routes) 정의 ---

/* (테스트용) */
app.get('/api/test', (req, res) => {
    res.json({ message: '👋 survey-app 백엔드 서버가 동작 중입니다!' });
});

/*
 * ========================================
 * 관리자용 API (설문지 CRUD)
 * ========================================
 */

/**
 * @route   POST /api/surveys
 * @desc    (C) 새 설문지 생성
 */
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

/**
 * @route   GET /api/surveys
 * @desc    (R) 모든 설문지 목록 조회
 */
app.get('/api/surveys', async (req, res) => {
    try {
        const surveys = await Survey.find({}, '-questions').sort({ createdAt: -1 }); // 최신순 정렬
        res.status(200).json(surveys);
    } catch (error) {
        console.error('🔥 설문지 목록 조회 오류:', error);
        res.status(500).json({ message: '서버 오류', error });
    }
});

/**
 * @route   PUT /api/surveys/:id
 * @desc    (U) 특정 설문지 수정 (3단계 새로 추가)
 */
app.put('/api/surveys/:id', async (req, res) => {
    try {
        const surveyId = req.params.id;
        const { title, description, questions } = req.body; // 수정할 새 내용

        const updatedSurvey = await Survey.findByIdAndUpdate(
            surveyId,
            { title, description, questions },
            { new: true, runValidators: true } // new: true (업데이트된 문서를 반환), runValidators (모델 유효성 검사 실행)
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

/**
 * @route   DELETE /api/surveys/:id
 * @desc    (D) 특정 설문지 삭제 (3단계 새로 추가)
 */
app.delete('/api/surveys/:id', async (req, res) => {
    try {
        const surveyId = req.params.id;
        
        // 1. 설문지 삭제
        const deletedSurvey = await Survey.findByIdAndDelete(surveyId);
        
        if (!deletedSurvey) {
            return res.status(404).json({ message: '삭제할 설문지를 찾을 수 없습니다.' });
        }

        // 2. (중요) 해당 설문지에 달린 '모든 응답'도 함께 삭제
        const deleteResult = await Response.deleteMany({ surveyId: surveyId });

        console.log(`🗑️ 설문지 삭제 완료: ${deletedSurvey.title} (연관 응답 ${deleteResult.deletedCount}개 삭제됨)`);
        res.status(200).json({ message: '설문지가 성공적으로 삭제되었습니다.' });

    } catch (error) {
        console.error('🔥 설문지 삭제 오류:', error);
        res.status(500).json({ message: '서버 오류', error });
    }
});


/*
 * ========================================
 * 사용자용 API (설문 응답)
 * ========================================
 */

/**
 * @route   GET /api/surveys/:id
 * @desc    (R) 특정 설문지 1개 조회 (질문 포함)
 */
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

/**
 * @route   POST /api/responses
 * @desc    (C) 설문 응답 제출 (3단계: 중복 체크 로직 추가)
 */
app.post('/api/responses', async (req, res) => {
    try {
        // 2단계에서 보낸 name, phone 값을 받음
        const { surveyId, name, phone, answers } = req.body;

        // 1. (안전장치) 해당 surveyId가 실존하는지 확인
        const surveyExists = await Survey.findById(surveyId);
        if (!surveyExists) {
            return res.status(404).json({ message: '존재하지 않는 설문지 ID입니다.' });
        }

        // 2. (중복 체크) 1단계에서 DB에 설정한 'unique' index를 활용
        // (같은 surveyId에 같은 phone이 있는지 DB가 자동으로 체크)
        const newResponse = new Response({
            surveyId,
            name,
            phone,
            answers
        });

        // 3. 데이터베이스에 저장
        await newResponse.save();
        
        console.log(`✅ 새 응답 저장 완료 (Survey: ${surveyId}, User: ${name})`);
        res.status(201).json({ message: '설문 응답이 성공적으로 제출되었습니다.' });

    } catch (error) {
        // 3. (중복 오류 처리) DB가 'unique' 위반 오류(E11000)를 반환했을 때
        if (error.code === 11000) {
            console.warn(`⚠️ 중복 응답 시도 감지 (Phone: ${req.body.phone})`);
            return res.status(409).json({ message: '이미 이 전화번호로 참여한 설문입니다.' });
        }
        
        console.error('🔥 응답 저장 오류:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.', error });
    }
});


/*
 * ========================================
 * 관리자용 API (엑셀/이메일)
 * ========================================
 */

/**
 * @route   GET /api/surveys/:id/export
 * @desc    엑셀/이메일 전송 (3단계: 이름, 전화번호 추가)
 */
app.get('/api/surveys/:id/export', async (req, res) => {
    try {
        const surveyId = req.params.id;

        // 1. 원본 설문지 정보
        const survey = await Survey.findById(surveyId);
        if (!survey) {
            return res.status(404).json({ message: '설문지를 찾을 수 없습니다.' });
        }

        // 2. 해당 설문지의 모든 응답
        const responses = await Response.find({ surveyId: surveyId }).sort({ submittedAt: 1 }); // 시간순 정렬
        if (responses.length === 0) {
            return res.status(400).json({ message: '이 설문지에는 아직 응답이 없습니다.' });
        }

        console.log(`[Export] ${responses.length}개의 응답을 엑셀로 변환 시작...`);

        // 3. 엑셀 데이터 생성 (헤더 + 본문)
        // --- 3단계: 헤더에 '이름', '전화번호' 추가 ---
        const headers = ['제출 시간', '이름', '전화번호', ...survey.questions.map(q => q.text)];
        const data = [headers]; // 엑셀의 첫 번째 줄 (제목)

        for (const response of responses) {
            const row = [ 
                response.submittedAt.toLocaleString('ko-KR'),
                response.name,    // A열: 제출 시간
                response.phone    // B열: 이름
            ];                  // C열: 전화번호
            
            // D열, E열... 질문 순서대로 답변을 매칭
            for (const question of survey.questions) {
                const answer = response.answers.find(a => a.questionText === question.text);
                row.push(answer ? answer.value : '(무응답)');
            }
            data.push(row);
        }

        // 4. 엑셀 파일(버퍼) 생성
        const ws = xlsx.utils.aoa_to_sheet(data); 
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, '설문응답');
        const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        console.log('[Export] 엑셀 파일 생성 완료. 이메일 전송 시작...');

        // 5. 이메일 전송
        await transporter.sendMail({
            from: 'ds20250829@gmail.com', // ◀= 본인 G메일 주소
            to: 'ds20250829@gmail.com', // ◀= 관리자님이 이메일을 받을 주소
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