require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

//one file because made in half day
//and easier to debug with AI

// ============================
// CONFIG - ใช้ Environment Variables
// ============================
const config = {
    LINE: {
        channelSecret: process.env.LINE_CHANNEL_SECRET,
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
    },
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_SHEET: {
        SPREADSHEET_ID: process.env.GOOGLE_SHEET_ID,
        STUDENTS_GID: process.env.STUDENTS_GID || '0',
        TEACHERS_GID: process.env.TEACHERS_GID ,
        GUEST_TEACHERS_GID: process.env.GUEST_TEACHERS_GID,
        SCHEDULE_GID: process.env.SCHEDULE_GID,
        SUBJECTS_GID: process.env.SUBJECTS_GID,
        FAQ_GID: process.env.FAQ_GID,
        ROOMS_GID: process.env.ROOMS_GID
    },
    SERVER: { 
        PORT: process.env.PORT || 3000 
    },
    TOP_K: parseInt(process.env.TOP_K) || 5
};

// Build Google Sheets URLs
const buildSheetURL = (gid) => {
    return `https://docs.google.com/spreadsheets/d/${config.GOOGLE_SHEET.SPREADSHEET_ID}/export?format=csv&gid=${gid}`;
};

const SHEET_URLS = {
    STUDENTS: buildSheetURL(config.GOOGLE_SHEET.STUDENTS_GID),
    TEACHERS: buildSheetURL(config.GOOGLE_SHEET.TEACHERS_GID),
    GUEST_TEACHERS: buildSheetURL(config.GOOGLE_SHEET.GUEST_TEACHERS_GID),
    SCHEDULE: buildSheetURL(config.GOOGLE_SHEET.SCHEDULE_GID),
    SUBJECTS: buildSheetURL(config.GOOGLE_SHEET.SUBJECTS_GID),
    FAQ: buildSheetURL(config.GOOGLE_SHEET.FAQ_GID),
    ROOMS: buildSheetURL(config.GOOGLE_SHEET.ROOMS_GID)
};

// Static college information (hardcoded - rarely changes)
const COLLEGE_INFO = {
    name: 'วิทยาลัยเทคนิคเชียงใหม่',
    shortName: 'CMTC',
    director: 'ดร.วัชรพงศ์ ฝั้นติ๊บ',
    department: {
        name: 'แผนกเทคโนโลยีสารสนเทศ',
        head: 'อาจารย์ฐาปนันท์ ปัญญามี',
        deputyHead: 'อาจารย์อนุชาติ รังสิยานนท์',
        email: 'itcmtc@cmtc.ac.th',
        phone: '053 217 708-9'
    },
    classRepresentatives: {
        head: 'นายพัฒนกุล เทปิน',
        deputy: 'นายนฤดล'
    },
    schedule: {
        regularDays: 'จันทร์-พฤหัสบดี เวลา 18:00-21:00 (เรียนที่วิทยาลัย)',
        friday: 'ศุกร์ เวลา 18:00-21:00 (เรียนออนไลน์)',
        saturday: 'เสาร์ เวลา 08:00-16:00 (เรียนที่วิทยาลัยเต็มวัน)',
        sunday: 'อาทิตย์ โฮมรูมออนไลน์'
    }
};

const ai = new GoogleGenerativeAI(config.GEMINI_API_KEY);
const EMBEDDING_MODEL = 'text-embedding-004';
const CHAT_MODEL_NAME = 'gemini-2.5-flash';

const chatModel = ai.getGenerativeModel({ model: CHAT_MODEL_NAME });
const embeddingModel = ai.getGenerativeModel({ model: `models/${EMBEDDING_MODEL}` });

// ============================
// CONVERSATION MEMORY
// ============================
const conversationHistory = new Map();

function addToHistory(userId, role, content) {
    if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
    }
    const history = conversationHistory.get(userId);
    history.push({ role, content });
    if (history.length > 10) {
        history.shift();
    }
}

function getHistory(userId) {
    return conversationHistory.get(userId) || [];
}

async function loadCSV(url) {
    try {
        const res = await axios.get(url);
        return parse(res.data, { columns: true, skip_empty_lines: true });
    } catch (error) {
        console.error(`Failed to load CSV from ${url}:`, error.message);
        return [];
    }
}

// ============================
// LOAD ALL SHEETS
// ============================
let students = [];
let teachers = [];
let guestTeachers = [];
let schedule = [];
let subjects = [];
let faqs = [];
let rooms = [];
let knowledgeBase = [];

async function loadSheets() {
    console.log('Loading all CSV sheets...');
    
    students = await loadCSV(SHEET_URLS.STUDENTS);
    teachers = await loadCSV(SHEET_URLS.TEACHERS);
    guestTeachers = await loadCSV(SHEET_URLS.GUEST_TEACHERS);
    schedule = await loadCSV(SHEET_URLS.SCHEDULE);
    subjects = await loadCSV(SHEET_URLS.SUBJECTS);
    faqs = await loadCSV(SHEET_URLS.FAQ);
    rooms = await loadCSV(SHEET_URLS.ROOMS);
    
    console.log(`Loaded: ${students.length} students, ${teachers.length} teachers, ${guestTeachers.length} guest teachers, ${schedule.length} schedule entries, ${subjects.length} subjects, ${faqs.length} FAQs, ${rooms.length} rooms`);

    // Build knowledge base with embeddings
    knowledgeBase = [];
    
    // Add students
    for (const s of students) {
        const text = `นักเรียนหมายเลข ${s.number} ชื่อ ${s.name} เพศ ${s.gender || ''} แผนก ${s.department || 'เทคโนโลยีสารสนเทศ'} ${s.role || 'นักเรียน'}`;
        const emb = await getEmbedding(text);
        knowledgeBase.push({ text, metadata: s, embedding: emb, type: 'student' });
    }
    
    // Add teachers (IT department only)
    for (const t of teachers) {
        const text = `อาจารย์ ${t.name} ตำแหน่ง ${t.position || 'ครูประจำแผนก'} เชี่ยวชาญด้าน ${t.specialize} สาขา ${t.field || 'เทคโนโลยีสารสนเทศ'}`;
        const emb = await getEmbedding(text);
        knowledgeBase.push({ text, metadata: t, embedding: emb, type: 'teacher' });
    }
    
    // Add guest teachers (from other departments)
    for (const gt of guestTeachers) {
        const text = `${gt.name} ${gt.position || 'อาจารย์พิเศษ'} จาก${gt.field} มาสอนวิชา ${gt.teaches_subject || ''} ให้แผนก IT`;
        const emb = await getEmbedding(text);
        knowledgeBase.push({ text, metadata: gt, embedding: emb, type: 'guest_teacher' });
    }
    
    // Add schedule
    for (const sc of schedule) {
        const text = `วิชา ${sc.subject_name} รหัส ${sc.subject_code || ''} สอนโดย ${sc.teacher} วัน${sc.day} เวลา ${sc.time_start}-${sc.time_end} ห้อง ${sc.room} ตึก ${sc.building || ''} ${sc.type || 'on-site'}`;
        const emb = await getEmbedding(text);
        knowledgeBase.push({ text, metadata: sc, embedding: emb, type: 'schedule' });
    }
    
    // Add subjects
    for (const sub of subjects) {
        const text = `วิชา ${sub.name} รหัส ${sub.code} ${sub.credits || ''} หน่วยกิต ${sub.description || ''}`;
        const emb = await getEmbedding(text);
        knowledgeBase.push({ text, metadata: sub, embedding: emb, type: 'subject' });
    }
    
    // Add FAQs
    for (const faq of faqs) {
        const text = `คำถาม: ${faq.question} คำตอบ: ${faq.answer} หมวด ${faq.category || ''}`;
        const emb = await getEmbedding(text);
        knowledgeBase.push({ text, metadata: faq, embedding: emb, type: 'faq' });
    }
    
    // Add rooms
    for (const rm of rooms) {
        const text = `ห้อง ${rm.room_number} ตึก ${rm.building} ความจุ ${rm.capacity || ''} คน สิ่งอำนวยความสะดวก ${rm.facilities || ''} แผนก ${rm.department || ''}`;
        const emb = await getEmbedding(text);
        knowledgeBase.push({ text, metadata: rm, embedding: emb, type: 'room' });
    }
    
    console.log(`Knowledge base built with ${knowledgeBase.length} entries`);
}

// ============================
// EMBEDDING
// ============================
async function getEmbedding(text) {
    if (!config.GEMINI_API_KEY) {
        console.error("Embedding Error: GEMINI_API_KEY is missing.");
        return [];
    }
    try {
        const result = await embeddingModel.embedContent(text);
        return result.embedding.values;
    } catch (error) {
        console.error('Embedding API Call Failed:', error.message);
        return [];
    }
}

function cosineSim(a, b) {
    let sum = 0, sumA = 0, sumB = 0;
    for (let i = 0; i < a.length; i++) {
        sum += a[i] * b[i];
        sumA += a[i] * a[i];
        sumB += b[i] * b[i];
    }
    if (sumA === 0 || sumB === 0) return 0;
    return sum / (Math.sqrt(sumA) * Math.sqrt(sumB));
}

function searchSimilarRows(queryEmbedding, k = config.TOP_K, filterType = null) {
    let filteredBase = knowledgeBase;
    if (filterType) {
        filteredBase = knowledgeBase.filter(item => item.type === filterType);
    }
    
    const scored = filteredBase.map(item => ({
        ...item,
        score: cosineSim(queryEmbedding, item.embedding)
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
}

// ============================
// QUERY ANALYSIS
// ============================
function analyzeQuery(question) {
    const analysis = {
        needsFullDataset: false,
        queryType: 'general',
        category: 'general',
        keywords: []
    };
    
    // Check if needs full dataset
    const countKeywords = ['กี่คน', 'ทั้งหมด', 'จำนวน', 'มีกี่', 'นับ', 'ทั้งหมดกี่', 'รายชื่อ'];
    analysis.needsFullDataset = countKeywords.some(kw => question.includes(kw));
    
    // Determine query type
    if (question.includes('นักเรียน') || question.includes('นักศึกษา') || question.includes('ผู้เรียน')) {
        analysis.queryType = 'student';
        analysis.category = 'students';
    } else if (question.includes('อาจารย์') || question.includes('ครู') || question.includes('ผู้สอน')) {
        analysis.queryType = 'teacher';
        analysis.category = 'teachers';
    } else if (question.includes('ตาราง') || question.includes('เรียน') || question.includes('วัน') || question.includes('เวลา')) {
        analysis.queryType = 'schedule';
        analysis.category = 'schedule';
    } else if (question.includes('วิชา') || question.includes('รายวิชา')) {
        analysis.queryType = 'subject';
        analysis.category = 'subjects';
    } else if (question.includes('ห้อง') || question.includes('ตึก')) {
        analysis.queryType = 'room';
        analysis.category = 'rooms';
    }
    
    return analysis;
}

// ============================
// CONTEXT BUILDER
// ============================
function buildContext(question, queryAnalysis, qEmb) {
    let context = '';
    let datasetInfo = '';
    
    // Add college static info
    const collegeContext = `
ข้อมูลวิทยาลัย:
- ชื่อ: ${COLLEGE_INFO.name} (${COLLEGE_INFO.shortName})
- ผู้อำนวยการ: ${COLLEGE_INFO.director}
- หัวหน้าแผนก IT: ${COLLEGE_INFO.department.head}
- รองหัวหน้าแผนก IT: ${COLLEGE_INFO.department.deputyHead}
- หัวหน้าห้อง: ${COLLEGE_INFO.classRepresentatives.head}
- รองหัวหน้าห้อง: ${COLLEGE_INFO.classRepresentatives.deputy}
- อีเมลแผนก: ${COLLEGE_INFO.department.email}
- เบอร์โทร: ${COLLEGE_INFO.department.phone}

ช่วงเวลาเรียน:
${COLLEGE_INFO.schedule.regularDays}
${COLLEGE_INFO.schedule.friday}
${COLLEGE_INFO.schedule.saturday}
${COLLEGE_INFO.schedule.sunday}
`;
    
    if (queryAnalysis.needsFullDataset) {
        switch (queryAnalysis.queryType) {
            case 'student':
                datasetInfo = `นักเรียนทั้งหมด ${students.length} คน:\n`;
                datasetInfo += students.map(s => 
                    `- หมายเลข ${s.number}: ${s.name} (${s.gender || ''}) ${s.role || 'นักเรียน'}`
                ).join('\n');
                
                // Add gender summary
                const maleCount = students.filter(s => s.gender === 'ชาย').length;
                const femaleCount = students.filter(s => s.gender === 'หญิง').length;
                datasetInfo += `\n\nสรุป: ชาย ${maleCount} คน, หญิง ${femaleCount} คน`;
                break;
            case 'teacher':
                datasetInfo = `อาจารย์ประจำแผนก IT ทั้งหมด ${teachers.length} คน:\n`;
                datasetInfo += teachers.map(t => 
                    `- ${t.name} (${t.position || 'ครูประจำแผนก'}) เชี่ยวชาญ ${t.specialize}`
                ).join('\n');
                
                if (guestTeachers.length > 0) {
                    datasetInfo += `\n\nอาจารย์พิเศษ/ผู้บริหารที่มาสอน ${guestTeachers.length} คน:\n`;
                    datasetInfo += guestTeachers.map(gt => 
                        `- ${gt.name} (${gt.position}) สอนวิชา ${gt.teaches_subject || ''}`
                    ).join('\n');
                }
                break;
            case 'schedule':
                datasetInfo = `ตารางเรียนทั้งหมด ${schedule.length} รายการ:\n`;
                datasetInfo += schedule.map(sc => 
                    `- วัน${sc.day} ${sc.time_start}-${sc.time_end}: ${sc.subject_name} โดย ${sc.teacher} ห้อง ${sc.room}`
                ).join('\n');
                break;
            default:
                datasetInfo = `
สรุปข้อมูลทั้งหมด:
- นักเรียน: ${students.length} คน
- อาจารย์ประจำแผนก IT: ${teachers.length} คน
- อาจารย์พิเศษ/ผู้บริหาร: ${guestTeachers.length} คน
- ตารางเรียน: ${schedule.length} รายการ
- วิชาเรียน: ${subjects.length} วิชา
`;
        }
        context = collegeContext + '\n' + datasetInfo;
    } else {
        // Use RAG search
        const topResults = searchSimilarRows(qEmb, 8);
        context = collegeContext + '\n\nข้อมูลที่เกี่ยวข้อง:\n' + topResults.map(r => r.text).join('\n');
        datasetInfo = `(ข้อมูลในระบบ: ${students.length} นักเรียน, ${teachers.length} อาจารย์ประจำแผนก, ${guestTeachers.length} อาจารย์พิเศษ, ${schedule.length} ตารางเรียน)`;
    }
    
    return { context, datasetInfo };
}

// ============================
// GENERATE ANSWER
// ============================
async function generateAnswer(question, userId = 'default') {
    const qEmb = await getEmbedding(question);
    
    if (qEmb.length === 0) {
        return "ขอภัย ไม่สามารถประมวลผลคำถามได้ในขณะนี้";
    }

    const queryAnalysis = analyzeQuery(question);
    const { context, datasetInfo } = buildContext(question, queryAnalysis, qEmb);
    
    const history = getHistory(userId);
    const conversationContext = history.length > 0 
        ? '\n\nประวัติการสนทนา:\n' + history.map(h => 
            `${h.role === 'user' ? 'ผู้ใช้' : 'Bot'}: ${h.content}`
          ).join('\n')
        : '';

    const systemInstruction = `คุณคือ CMTC IT Chatbot ผู้ช่วยตอบคำถามเกี่ยวกับแผนกเทคโนโลยีสารสนเทศ วิทยาลัยเทคนิคเชียงใหม่

หลักการตอบคำถาม:
- ตอบตามข้อมูลที่ให้มาเท่านั้น ห้ามสมมติข้อมูล
- ถ้าถามจำนวน ให้นับตามข้อมูลจริง
- ถ้าถาม "อาจารย์แผนก IT" หรือ "อาจารย์ประจำแผนก" ให้ตอบเฉพาะอาจารย์ในแผนก IT เท่านั้น (ไม่รวมอาจารย์พิเศษ/ผู้บริหาร)
- ถ้าถาม "อาจารย์ที่มาสอน" หรือ "อาจารย์ผู้สอนวิชา" ให้ตอบทั้งอาจารย์ประจำแผนกและอาจารย์พิเศษ
- ถ้าถามตารางเรียน ให้ระบุวัน เวลา ห้อง และอาจารย์ผู้สอน
- ถ้าคำถามคลุมเครือ ให้ดูจากประวัติการสนทนา
- ตอบสั้น กระชับ เป็นธรรมชาติ เป็นมิตร
- ใช้ภาษาไทยในการตอบ
- ถ้าไม่มีข้อมูล ให้บอกตรงๆ ว่าไม่มีข้อมูล`;

    const userPrompt = `${systemInstruction}

${context}
${datasetInfo}

คำถาม: ${question}

กรุณาตอบคำถามตามข้อมูลที่มีเท่านั้น`;

    try {
        const result = await chatModel.generateContent({
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 1000 }
        });
        
        const answer = result.response.text();
        
        addToHistory(userId, 'user', question);
        addToHistory(userId, 'assistant', answer);
        
        return answer;
    } catch (error) {
        console.error('Gemini API Error:', error.message);
        return "ขออภัย เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่อีกครั้ง";
    }
}

// ============================
// ROUTES
// ============================
const lineClient = new line.Client(config.LINE);

app.get('/', (req, res) => {
    res.json({
        status: 'running',
        message: 'CMTC IT Chatbot API',
        endpoints: {
            ask: '/ask?text=your_question',
            webhook: '/webhook (POST)',
            reload: '/reload-sheets',
            stats: '/stats'
        }
    });
});

app.get('/stats', (req, res) => {
    res.json({
        students: students.length,
        teachers: teachers.length,
        guestTeachers: guestTeachers.length,
        schedule: schedule.length,
        subjects: subjects.length,
        faqs: faqs.length,
        rooms: rooms.length,
        knowledgeBase: knowledgeBase.length,
        activeConversations: conversationHistory.size
    });
});

app.get('/reload-sheets', async (req, res) => {
    try {
        await loadSheets();
        res.json({ status: 'success', message: 'Sheets reloaded successfully' });
    } catch (error) {
        res.json({ status: 'error', message: error.message });
    }
});

app.get('/ask', async (req, res) => {
    const text = req.query.text;
    const userId = req.query.userId || 'web-user';
    if (!text) {
        return res.json({ error: 'กรุณาส่ง query ?text=...' });
    }
    const answer = await generateAnswer(text, userId);
    res.json({ question: text, answer, userId });
});

app.post('/webhook', line.middleware(config.LINE), async (req, res) => {
    try {
        const events = req.body.events;
        for (const event of events) {
            if (event.type === 'message' && event.message.type === 'text') {
                const userId = event.source.userId;
                const replyText = await generateAnswer(event.message.text, userId);
                await lineClient.replyMessage(event.replyToken, { 
                    type: 'text', 
                    text: replyText 
                });
            } else {
                await lineClient.replyMessage(event.replyToken, { 
                    type: 'text', 
                    text: 'ส่งข้อความเป็นตัวอักษรเท่านั้นนะครับ' 
                });
            }
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('Webhook Error:', err.message);
        res.sendStatus(200);
    }
});

// ============================
// START SERVER
// ============================
app.listen(config.SERVER.PORT, async () => {
    console.log(` CMTC IT Chatbot running on port ${config.SERVER.PORT}`);
    
    // Validate required environment variables
    if (!config.GEMINI_API_KEY) {
        console.error(" FATAL: GEMINI_API_KEY is missing");
        return;
    }
    if (!config.LINE.channelSecret || !config.LINE.channelAccessToken) {
        console.error(" WARNING: LINE credentials are missing");
    }
    if (!config.GOOGLE_SHEET.SPREADSHEET_ID) {
        console.error(" FATAL: GOOGLE_SHEET_ID is missing");
        return;
    }
    
    await loadSheets();
    console.log('System ready!');
});