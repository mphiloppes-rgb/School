// ============================================
// server.js — الخادم الرئيسي
// تشغيل: node server.js
// ============================================

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'school_secret_key_change_in_production';

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json());

// Upload storage
const upload = multer({ storage: multer.memoryStorage() });

// ============================================
// "DATABASE" في الذاكرة (في الإنتاج: MongoDB)
// ============================================
let db = {
  admin: {
    username: 'admin',
    password: bcrypt.hashSync('1234', 10)
  },
  settings: {
    schoolName: 'مدرسة النور الإعدادية',
    year: '2024/2025',
    allowRegister: true,
    allowResults: true,
    allowCertificates: true
  },
  subjects: ['عربي', 'رياضيات', 'علوم', 'دراسات', 'إنجليزي'],
  news: [
    { id: 1, title: 'تم نشر نتائج الفصل الأول', body: 'يمكن للطلاب الاستعلام برقم الجلوس', date: '2025-03-15' },
    { id: 2, title: 'امتحانات الفصل الثاني', body: 'تبدأ امتحانات الفصل الثاني في الأول من مايو', date: '2025-03-10' }
  ],
  publish: { term1: true, term2: false },
  students: [
    { id: 1, name: 'أحمد محمد علي', seatNumber: '1234', grade: 'ثانية إعدادي', class: '1/4', phone: '01012345678', parentPhone: '01098765432', active: true, type: 'student' },
    { id: 2, name: 'سارة علي حسن', seatNumber: '5678', grade: 'أولى ثانوي', class: '2/2', phone: '01112223344', parentPhone: '01223344556', active: true, type: 'student' },
  ],
  results: {
    term1: {
      '1234': { total: 390, outOf: 500, subjects: { 'عربي': { score: 82, outOf: 100 }, 'رياضيات': { score: 75, outOf: 100 }, 'علوم': { score: 88, outOf: 100 }, 'دراسات': { score: 79, outOf: 100 }, 'إنجليزي': { score: 66, outOf: 100 } } },
      '5678': { total: 440, outOf: 500, subjects: { 'عربي': { score: 92, outOf: 100 }, 'رياضيات': { score: 85, outOf: 100 }, 'علوم': { score: 95, outOf: 100 }, 'دراسات': { score: 88, outOf: 100 }, 'إنجليزي': { score: 80, outOf: 100 } } }
    },
    term2: {}
  },
  certificateTemplate: null
};

// ============================================
// AUTH MIDDLEWARE
// ============================================
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token غير صالح' });
  }
}

// ============================================
// PUBLIC ROUTES
// ============================================

// البحث عن طالب بالاسم → إرجاع رقم الجلوس
app.post('/api/auth/lookup', (req, res) => {
  const { name, grade, class: cls, phone, parentPhone, type } = req.body;
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });

  const student = db.students.find(s =>
    s.name.trim() === name.trim() &&
    (!grade || s.grade === grade) &&
    s.active
  );

  if (!student) return res.status(404).json({ error: 'لم يتم العثور على الاسم في قاعدة البيانات' });

  res.json({
    found: true,
    seatNumber: student.seatNumber,
    name: student.name,
    grade: student.grade,
    class: student.class
  });
});

// جلب نتيجة طالب برقم الجلوس
app.get('/api/results/:seatNumber', (req, res) => {
  const { seatNumber } = req.params;
  const student = db.students.find(s => s.seatNumber === seatNumber);
  if (!student) return res.status(404).json({ error: 'رقم الجلوس غير موجود' });

  const result = {
    student: {
      name: student.name,
      grade: student.grade,
      class: student.class,
      seatNumber: student.seatNumber
    },
    term1: db.publish.term1 ? (db.results.term1[seatNumber] || null) : null,
    term2: db.publish.term2 ? (db.results.term2[seatNumber] || null) : null,
    publishStatus: db.publish
  };

  res.json(result);
});

// الأخبار
app.get('/api/news', (req, res) => {
  res.json(db.news.sort((a, b) => new Date(b.date) - new Date(a.date)));
});

// إعدادات الموقع العامة
app.get('/api/settings', (req, res) => {
  res.json({
    schoolName: db.settings.schoolName,
    year: db.settings.year,
    publishStatus: db.publish,
    allowRegister: db.settings.allowRegister,
    allowResults: db.settings.allowResults
  });
});

// التحقق من شهادة عبر QR
app.get('/api/verify/:seatNumber', (req, res) => {
  const student = db.students.find(s => s.seatNumber === req.params.seatNumber);
  if (!student) return res.status(404).json({ valid: false });
  res.json({ valid: true, name: student.name, grade: student.grade, year: db.settings.year });
});

// ============================================
// ADMIN ROUTES (محمية بـ JWT)
// ============================================

// تسجيل دخول الأدمن
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (username !== db.admin.username) return res.status(401).json({ error: 'بيانات خاطئة' });
  const valid = await bcrypt.compare(password, db.admin.password);
  if (!valid) return res.status(401).json({ error: 'بيانات خاطئة' });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, message: 'تم تسجيل الدخول بنجاح' });
});

// جلب المستخدمين
app.get('/api/admin/users', authMiddleware, (req, res) => {
  const { grade, active, search } = req.query;
  let list = [...db.students];
  if (grade) list = list.filter(s => s.grade === grade);
  if (active !== undefined) list = list.filter(s => s.active === (active === 'true'));
  if (search) list = list.filter(s => s.name.includes(search) || s.seatNumber.includes(search));
  res.json({ total: list.length, students: list });
});

// تفعيل/تعطيل مستخدم
app.patch('/api/admin/users/:id', authMiddleware, (req, res) => {
  const student = db.students.find(s => s.id === parseInt(req.params.id));
  if (!student) return res.status(404).json({ error: 'الطالب غير موجود' });
  student.active = req.body.active ?? !student.active;
  res.json({ message: 'تم التحديث', student });
});

// رفع Excel بيانات الطلاب
app.post('/api/admin/upload/users', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);

    let added = 0, updated = 0;
    rows.forEach((row, i) => {
      const existing = db.students.find(s => s.seatNumber === String(row.seat_number));
      if (existing) {
        Object.assign(existing, {
          name: row.student_name || existing.name,
          grade: row.grade || existing.grade,
          class: row.class || existing.class,
          phone: String(row.phone || existing.phone),
          parentPhone: String(row.parent_phone || existing.parentPhone),
          active: row.status === 'active'
        });
        updated++;
      } else {
        db.students.push({
          id: Date.now() + i,
          name: row.student_name,
          seatNumber: String(row.seat_number),
          grade: row.grade,
          class: String(row.class),
          phone: String(row.phone || ''),
          parentPhone: String(row.parent_phone || ''),
          active: row.status !== 'inactive',
          type: 'student'
        });
        added++;
      }
    });

    res.json({ message: `تمت المعالجة: ${added} جديد، ${updated} تحديث`, added, updated });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في قراءة الملف: ' + err.message });
  }
});

// رفع Excel نتائج
app.post('/api/admin/upload/results', authMiddleware, upload.single('file'), (req, res) => {
  const { term, grade } = req.body; // term: 'term1' | 'term2'
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
  if (!term) return res.status(400).json({ error: 'يجب تحديد الفصل الدراسي' });

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);

    let count = 0;
    rows.forEach(row => {
      const seat = String(row.seat_number);
      const subjects = {};
      db.subjects.forEach(subj => {
        const key = subj + '_score';
        if (row[key] !== undefined) {
          subjects[subj] = { score: Number(row[key]), outOf: Number(row[subj + '_out_of'] || 100) };
        }
      });
      db.results[term][seat] = {
        total: Number(row.total_score),
        outOf: Number(row.total_out_of || 500),
        subjects
      };
      count++;
    });

    res.json({ message: `تم رفع نتائج ${count} طالب للـ ${term === 'term1' ? 'الفصل الأول' : 'الفصل الثاني'}`, count });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في قراءة الملف: ' + err.message });
  }
});

// تنزيل Template إدارة المستخدمين
app.get('/api/admin/template/users', authMiddleware, (req, res) => {
  const wb = XLSX.utils.book_new();
  const data = [
    { student_name: 'مثال: أحمد محمد', seat_number: '1001', grade: 'ثانية إعدادي', class: '1/4', phone: '01012345678', parent_phone: '01098765432', status: 'active' }
  ];
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="students_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// تنزيل Template النتائج لصف معين
app.get('/api/admin/template/results/:grade', authMiddleware, (req, res) => {
  const { term } = req.query;
  const wb = XLSX.utils.book_new();

  // بناء أعمدة المواد ديناميكياً
  const subjectCols = {};
  db.subjects.forEach(s => {
    subjectCols[s + '_score'] = '';
    subjectCols[s + '_out_of'] = 100;
  });

  const data = [
    { student_name: 'مثال', seat_number: '1001', total_score: '', total_out_of: 500, ...subjectCols }
  ];
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'النتائج');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const grade = decodeURIComponent(req.params.grade);
  res.setHeader('Content-Disposition', `attachment; filename="results_${grade}_${term || 'term1'}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// إضافة مادة
app.post('/api/admin/subjects', authMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المادة مطلوب' });
  if (db.subjects.includes(name)) return res.status(400).json({ error: 'المادة موجودة بالفعل' });
  db.subjects.push(name);
  res.json({ message: 'تمت إضافة المادة', subjects: db.subjects });
});

// الأخبار
app.post('/api/admin/news', authMiddleware, (req, res) => {
  const { title, body } = req.body;
  if (!title) return res.status(400).json({ error: 'العنوان مطلوب' });
  const news = { id: Date.now(), title, body, date: new Date().toISOString().split('T')[0] };
  db.news.unshift(news);
  res.json({ message: 'تم إضافة الخبر', news });
});

app.delete('/api/admin/news/:id', authMiddleware, (req, res) => {
  db.news = db.news.filter(n => n.id !== parseInt(req.params.id));
  res.json({ message: 'تم الحذف' });
});

// التحكم في نشر النتائج
app.post('/api/admin/publish', authMiddleware, (req, res) => {
  const { term1, term2 } = req.body;
  if (term1 !== undefined) db.publish.term1 = term1;
  if (term2 !== undefined) db.publish.term2 = term2;
  res.json({ message: 'تم التحديث', publish: db.publish });
});

// الإعدادات العامة
app.post('/api/admin/settings', authMiddleware, (req, res) => {
  Object.assign(db.settings, req.body);
  res.json({ message: 'تم حفظ الإعدادات', settings: db.settings });
});

// تغيير كلمة المرور
app.post('/api/admin/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const valid = await bcrypt.compare(currentPassword, db.admin.password);
  if (!valid) return res.status(400).json({ error: 'كلمة المرور الحالية خاطئة' });
  db.admin.password = await bcrypt.hash(newPassword, 10);
  res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
});

// رفع تيمبلت الشهادة
app.post('/api/admin/certificate/template', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع صورة' });
  const coords = JSON.parse(req.body.coords || '{}');
  db.certificateTemplate = {
    imageBuffer: req.file.buffer.toString('base64'),
    mimeType: req.file.mimetype,
    coords
  };
  res.json({ message: 'تم حفظ تيمبلت الشهادة' });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`✅ السيرفر شغال على: http://localhost:${PORT}`);
  console.log(`📋 Admin login: admin / 1234`);
});
