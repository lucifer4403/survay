// models/Survey.js (1단계 수정본)
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 개별 질문의 구조
const QuestionSchema = new Schema({
    text: { 
        type: String, 
        required: true 
    },
    type: { 
        type: String, 
        required: true, 
        // --- 1단계: 'dropdown'을 허용 목록(enum)에 추가 ---
        enum: ['text', 'choice', 'rating', 'dropdown'] 
        // ---------------------------------------------
    },
    options: [{ // 객관식(choice) 또는 드롭다운(dropdown)일 경우 선택지
        type: String 
    }]
});

// 전체 설문지 구조
const SurveySchema = new Schema({
    title: { 
        type: String, 
        required: true 
    },
    description: { 
        type: String 
    },
    questions: [QuestionSchema], // 질문 목록
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Survey', SurveySchema);