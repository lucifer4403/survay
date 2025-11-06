// models/Response.js (1단계 수정본)
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 개별 답변 구조 (이 부분은 동일)
const AnswerSchema = new Schema({
    questionText: { 
        type: String,
        required: true
    },
    value: { 
        type: String,
        required: true
    }
});

// 전체 응답지 구조
const ResponseSchema = new Schema({
    surveyId: { 
        type: Schema.Types.ObjectId,
        ref: 'Survey', 
        required: true
    },
    
    // --- 1단계: 중복 체크를 위해 추가된 필드 ---
    name: {
        type: String,
        required: true // 응답 시 이름 필수
    },
    phone: {
        type: String,
        required: true, // 응답 시 전화번호 필수
        index: true // 전화번호로 검색(findOne)을 빠르게 하기 위해 'index' 추가
    },
    // ----------------------------------------

    answers: [AnswerSchema], // 답변 목록
    
    submittedAt: {
        type: Date,
        default: Date.now
    }
});

// 한 설문지(surveyId) 내에서 전화번호(phone)는 고유해야 함
// (index: true와 함께 중복 저장 자체를 DB 레벨에서 방지)
ResponseSchema.index({ surveyId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('Response', ResponseSchema);