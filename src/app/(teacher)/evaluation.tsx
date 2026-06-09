import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import GlobalHeader from '../../components/GlobalHeader';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Bot, Upload, FileText, CheckCircle, X, FileSpreadsheet, ChevronLeft, ChevronRight, BookOpen, AlertCircle } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { buildSystemPrompt, buildExamContext, buildStudentPrompt, parseEvaluationResponse } from '../../lib/evaluation/prompt';
import { evaluateWithGemini } from '../../lib/gemini';
import * as XLSX from 'xlsx';
import { Buffer } from 'buffer';

type Exam = { id: string; title: string; subject: string; total_marks: number; exam_type?: string; offering_id?: string; };
type ExamGroup = {
  offeringId: string | null;
  courseCode: string;
  courseTitle: string;
  courseType: string;
  exams: Exam[];
};

type FileItem = {
  id: string; name: string; uri: string; mimeType?: string;
  state: 'pending' | 'uploading' | 'evaluating' | 'done' | 'error';
};

const convertUriToBase64 = async (uri: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = function () {
      try {
        const arrayBuffer = xhr.response;
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        resolve(base64);
      } catch (err) {
        reject(err);
      }
    };
    xhr.onerror = function (err) {
      reject(new Error(`Failed to read file at ${uri}`));
    };
    xhr.responseType = 'arraybuffer';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
};

export default function TeacherEvaluationScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [examGroups, setExamGroups] = useState<ExamGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Navigation State
  const [selectedGroup, setSelectedGroup] = useState<ExamGroup | null>(null);
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  
  // Evaluation Mode (inside an exam)
  const [mode, setMode] = useState<'ai' | 'excel'>('ai');
  
  // AI Mode State
  const [questionPaper, setQuestionPaper] = useState('');
  const [rubric, setRubric] = useState('');
  const [files, setFiles] = useState<FileItem[]>([]);
  
  // Excel Mode State (Course or Exam level)
  const [excelFile, setExcelFile] = useState<FileItem | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    async function fetchExamsGrouped() {
      if (!user) return;
      const { data: exams, error } = await supabase
        .from('exams')
        .select(`
          id, title, subject, total_marks, exam_type, offering_id,
          offering:course_offerings!exams_offering_id_fkey(
            id,
            course:courses!course_offerings_course_id_fkey(code, title, course_type)
          )
        `)
        .eq('created_by', user.id)
        .order('created_at', { ascending: true });

      if (error || !exams) {
        setLoading(false);
        return;
      }

      const groupMap = new Map<string, ExamGroup>();
      for (const exam of exams) {
        const offering = exam.offering as any;
        const key = offering?.id ?? "custom";
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            offeringId: offering?.id ?? null,
            courseCode: offering?.course?.code ?? "Custom",
            courseTitle: offering?.course?.title ?? exam.subject,
            courseType: offering?.course?.course_type ?? "theory",
            exams: [],
          });
        }
        groupMap.get(key)!.exams.push(exam as Exam);
      }
      setExamGroups([...groupMap.values()]);
      setLoading(false);
    }
    fetchExamsGrouped();
  }, [user]);

  const handleSelectFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: true });
      if (!result.canceled && result.assets) {
        const newFiles = result.assets.map(asset => ({
          id: Math.random().toString(36).substring(7), name: asset.name, uri: asset.uri, mimeType: asset.mimeType, state: 'pending' as const,
        }));
        setFiles(prev => [...prev, ...newFiles]);
      }
    } catch (err) { console.log('Error', err); }
  };

  const handleSelectExcel = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'],
        multiple: false,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setExcelFile({
          id: Math.random().toString(36).substring(7), name: asset.name, uri: asset.uri, mimeType: asset.mimeType, state: 'pending',
        });
      }
    } catch (err) { console.log('Error picking excel', err); }
  };

  const updateFileState = (id: string, state: FileItem['state']) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, state } : f));
  };

  // Component detection from column name (same as web app)
  const detectComponent = (col: string): string => {
    const cl = col.toLowerCase();
    if (/internal|quiz|assign/i.test(cl)) return "internal";
    if (/mid/i.test(cl)) return "mid";
    if (/continuous|lab/i.test(cl)) return "continuous";
    if (/guide/i.test(cl)) return "guide";
    if (/viva/i.test(cl)) return "viva";
    if (/review/i.test(cl)) return "midterm_review";
    if (/end|final/i.test(cl)) return "end";
    return "end";
  };

  // Internal upload marks function matching admin.ts uploadMarks
  const uploadMarks = async (offeringId: string, component: string, maxMarks: number, entries: Array<{ rollNumber: string; marks: number }>) => {
    // 1. Get enrollments for this offering with student roll numbers
    const { data: enrollments, error: enrolErr } = await supabase
      .from("enrollments")
      .select("id, student:profiles!enrollments_student_id_fkey(roll_number)")
      .eq("offering_id", offeringId)
      .not("status", "eq", "dropped");

    if (enrolErr) throw enrolErr;
    if (!enrollments?.length) return { matched: 0, unmatched: entries.map((e) => e.rollNumber) };

    const rollToEnrollment = new Map<string, string>();
    for (const e of enrollments) {
      const student = e.student as unknown as { roll_number: string } | null;
      if (student?.roll_number) rollToEnrollment.set(student.roll_number.toUpperCase(), e.id);
    }

    const matched: Array<{ enrollment_id: string; component: string; marks_obtained: number; max_marks: number }> = [];
    const unmatched: string[] = [];

    for (const entry of entries) {
      const enrollmentId = rollToEnrollment.get(entry.rollNumber.toUpperCase());
      if (enrollmentId) {
        matched.push({ enrollment_id: enrollmentId, component, marks_obtained: entry.marks, max_marks: maxMarks });
      } else {
        unmatched.push(entry.rollNumber);
      }
    }

    if (matched.length > 0) {
      for (const m of matched) {
        const { error: upsertErr } = await supabase.from("student_marks").upsert(m, { onConflict: "enrollment_id,component" });
        if (upsertErr) throw upsertErr;
      }
    }

    return { matched: matched.length, unmatched };
  };

  const handleCourseExcelUpload = async () => {
    if (!selectedGroup || !excelFile || !selectedGroup.offeringId) return;
    setIsRunning(true);
    try {
      const base64 = await convertUriToBase64(excelFile.uri);
      const workbook = XLSX.read(base64, { type: 'base64' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(sheet);

      if (!json.length) throw new Error("Empty file");
      const headers = Object.keys(json[0]);
      const rollCol = headers.find((h) => /roll|number|id/i.test(h));
      if (!rollCol) throw new Error("No Roll Number column found");

      const markCols = headers.filter((h) => h !== rollCol);
      if (!markCols.length) throw new Error("No mark columns found");

      let totalMatched = 0;
      const allUnmatched: string[] = [];

      for (const col of markCols) {
        const component = detectComponent(col);
        const matchingExam = selectedGroup.exams.find((e) => e.exam_type === component);
        const maxMarksFromCol = col.match(/(\d+)/);
        const maxMarks = matchingExam?.total_marks ?? (maxMarksFromCol ? parseInt(maxMarksFromCol[1]) : 100);

        const entries = json
          .filter((r) => r[rollCol] != null && r[col] != null && r[col] !== "")
          .map((r) => ({ rollNumber: String(r[rollCol]).trim(), marks: Number(r[col]) }));

        const res = await uploadMarks(selectedGroup.offeringId, component, maxMarks, entries);
        totalMatched += res.matched;
        allUnmatched.push(...res.unmatched.filter((u) => !allUnmatched.includes(u)));
      }

      setExcelFile(prev => prev ? { ...prev, state: 'done' } : null);
      Alert.alert(
        'Upload Complete',
        `${totalMatched} entries saved across ${markCols.length} component(s).${allUnmatched.length ? ` Unmatched: ${allUnmatched.join(", ")}` : " All matched!"}`
      );
    } catch (err: any) {
      setExcelFile(prev => prev ? { ...prev, state: 'error' } : null);
      Alert.alert('Upload Error', err.message || 'Failed to parse Excel.');
    }
    setIsRunning(false);
  };

  const handleExamExcelUpload = async () => {
    if (!selectedExam || !excelFile) return;
    if (!selectedExam.offering_id) {
      return Alert.alert('Error', 'No course offering linked. Custom exams must be evaluated individually.');
    }
    setIsRunning(true);
    try {
      const base64 = await convertUriToBase64(excelFile.uri);
      const workbook = XLSX.read(base64, { type: 'base64' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(sheet);

      if (!json.length) throw new Error("Empty file");
      const headers = Object.keys(json[0]);
      const rollCol = headers.find((h) => /roll|number|id/i.test(h));
      if (!rollCol) throw new Error("No Roll Number column found");
      const marksCol = headers.find((h) => h !== rollCol);
      if (!marksCol) throw new Error("Need at least 2 columns: Roll Number + Marks");

      const component = selectedExam.exam_type ?? "end";
      const entries = json
        .filter((r) => r[rollCol] != null && r[marksCol] != null && r[marksCol] !== "")
        .map((r) => ({ rollNumber: String(r[rollCol]).trim(), marks: Number(r[marksCol]) }));

      const res = await uploadMarks(selectedExam.offering_id, component, selectedExam.total_marks, entries);
      setExcelFile(prev => prev ? { ...prev, state: 'done' } : null);
      Alert.alert(
        'Upload Complete',
        `${res.matched} entries saved for ${selectedExam.title}.${res.unmatched.length ? ` Unmatched: ${res.unmatched.join(", ")}` : " All matched!"}`
      );
    } catch (err: any) {
      setExcelFile(prev => prev ? { ...prev, state: 'error' } : null);
      Alert.alert('Upload Error', err.message || 'Failed to parse Excel.');
    }
    setIsRunning(false);
  };

  const handleStartBatchEvaluation = async () => {
    if (!selectedExam) return;
    if (files.length === 0) return Alert.alert('Missing Files', 'Select PDFs to evaluate.');
    if (!questionPaper.trim() || !rubric.trim()) return Alert.alert('Required Fields', 'Question Paper and Rubric are mandatory for AI Evaluation.');

    setIsRunning(true);
    const batchId = Math.random().toString(36).substring(2, 15);
    const systemPrompt = buildSystemPrompt();
    const examContext = buildExamContext(questionPaper, rubric, {
      title: selectedExam.title, subject: selectedExam.subject, totalMarks: selectedExam.total_marks
    });

    for (const file of files) {
      if (file.state !== 'pending' && file.state !== 'error') continue;
      updateFileState(file.id, 'uploading');
      try {
        const uploadPath = `temp/${batchId}/${file.name}`;
        const fileBase64 = await convertUriToBase64(file.uri);
        
        const buffer = Buffer.from(fileBase64, 'base64');
        const { error: uploadError } = await supabase.storage.from('answer-scripts').upload(uploadPath, buffer, { contentType: file.mimeType || 'application/pdf', upsert: true });
        if (uploadError) throw uploadError;

        updateFileState(file.id, 'evaluating');
        const studentPrompt = buildStudentPrompt(file.name, false);
        const rawJsonStr = await evaluateWithGemini(fileBase64, file.mimeType || 'application/pdf', systemPrompt, examContext, studentPrompt);
        const parsed = parseEvaluationResponse(rawJsonStr);
        
        for (const student of parsed.students) {
          const studentRoll = student.roll_number.trim();
          const { data: profile } = await supabase.from('profiles').select('id').eq('roll_number', studentRoll).single();
          
          let script: { id: string } | null = null;
          let scriptErr: any = null;
          const studentId = profile?.id ?? null;

          // Upload PDF to permanent location
          const storageKey = studentId ?? studentRoll;
          const permanentPath = `${selectedExam.id}/${storageKey}.pdf`;
          const { error: permUploadError } = await supabase.storage
            .from('answer-scripts')
            .upload(permanentPath, buffer, { contentType: file.mimeType || 'application/pdf', upsert: true });

          if (permUploadError) {
            console.warn(`[storage] Permanent upload failed for ${studentRoll}:`, permUploadError.message);
          }

          if (studentId) {
            // Registered student - upsert by exam_id + student_id
            const res = await supabase.from('answer_scripts').upsert({
              exam_id: selectedExam.id,
              student_id: studentId,
              roll_number: studentRoll,
              status: 'evaluated',
              total_awarded: student.total_awarded,
              evaluated_at: new Date().toISOString(),
              pdf_path: permanentPath
            }, { onConflict: 'exam_id,student_id' }).select('id').single();
            script = res.data;
            scriptErr = res.error;
          } else {
            // Orphan - check if exists by roll_number + exam_id, then update or insert
            const { data: existing } = await supabase
              .from('answer_scripts')
              .select('id')
              .eq('exam_id', selectedExam.id)
              .eq('roll_number', studentRoll)
              .maybeSingle();

            if (existing) {
              const res = await supabase
                .from('answer_scripts')
                .update({
                  status: 'evaluated',
                  total_awarded: student.total_awarded,
                  evaluated_at: new Date().toISOString(),
                  pdf_path: permanentPath
                })
                .eq('id', existing.id)
                .select('id')
                .single();
              script = res.data;
              scriptErr = res.error;
            } else {
              const res = await supabase
                .from('answer_scripts')
                .insert({
                  exam_id: selectedExam.id,
                  roll_number: studentRoll,
                  status: 'evaluated',
                  total_awarded: student.total_awarded,
                  evaluated_at: new Date().toISOString(),
                  pdf_path: permanentPath
                })
                .select('id')
                .single();
              script = res.data;
              scriptErr = res.error;
            }
          }

          if (scriptErr) throw scriptErr;
          if (student.questions && script?.id) {
            const questionRows = student.questions.map(q => ({
              script_id: script.id,
              qno: q.qno,
              max_marks: q.max_marks,
              awarded_marks: q.awarded_marks,
              verdict: q.verdict,
              ai_feedback: q.ai_feedback,
              correct_approach: q.correct_approach
            }));
            await supabase.from('script_questions').delete().eq('script_id', script.id);
            await supabase.from('script_questions').insert(questionRows);
          }
        }
        // Clean up temp upload
        await supabase.storage.from('answer-scripts').remove([uploadPath]).catch(() => {});
        updateFileState(file.id, 'done');
      } catch (err) {
        console.error(err);
        // Clean up temp upload on error
        const uploadPath = `temp/${batchId}/${file.name}`;
        await supabase.storage.from('answer-scripts').remove([uploadPath]).catch(() => {});
        updateFileState(file.id, 'error');
      }
    }
    setIsRunning(false);
    Alert.alert('Batch Complete', 'All scripts processed.');
  };

  const getCourseColumns = (type: string) => {
    if (type === 'theory') return ['Roll Number', 'Internal', 'Mid-Sem', 'End-Sem'];
    if (type === 'lab') return ['Roll Number', 'Continuous', 'End-Sem'];
    return ['Roll Number', 'Guide', 'Midterm Review', 'Viva'];
  };

  if (loading) return <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator size="large" color={Colors.dark.primary} /></View>;

  // 1. List of Courses
  if (!selectedGroup) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.dark.background }}>
        <GlobalHeader role="teacher" title="AI Evaluation" />
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Select Course</Text>
            <Text style={styles.subText}>Choose a course to evaluate its exams</Text>
          </View>
          <View style={{ gap: 12 }}>
            {examGroups.map(group => (
              <TouchableOpacity key={group.courseCode} style={styles.card} onPress={() => setSelectedGroup(group)}>
                <View style={styles.cardIcon}><BookOpen size={20} color={Colors.dark.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{group.courseCode}</Text>
                  <Text style={styles.cardSubTitle}>{group.courseTitle}</Text>
                  <Text style={styles.cardInfo}>{group.exams.length} Exams Configured</Text>
                </View>
                <ChevronRight size={20} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  // 2. Course Details (List Exams + Course Excel Upload)
  if (!selectedExam) {
    const courseCols = getCourseColumns(selectedGroup.courseType);
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: Colors.dark.background }}>
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setSelectedGroup(null)}>
            <ChevronLeft size={20} color={Colors.dark.textSecondary} />
            <Text style={styles.backText}>Back to Courses</Text>
          </TouchableOpacity>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{selectedGroup.courseCode}</Text>
          <Text style={styles.subText}>{selectedGroup.courseTitle}</Text>
        </View>

        {/* Course-level Excel Upload */}
        {selectedGroup.offeringId ? (
          <View style={styles.uploadSection}>
            <Text style={styles.sectionTitle}>Course-Level Excel Upload</Text>
            <Text style={styles.helperText}>Upload one Excel sheet with Roll No and all component columns.</Text>
            
            <View style={styles.formatBox}>
              <Text style={styles.formatTitle}>Expected Columns (Exactly {courseCols.length} Columns):</Text>
              <View style={styles.formatRow}>
                {courseCols.map((c, i) => (
                  <View key={c} style={styles.formatHeader}>
                    <Text style={styles.formatHeaderText} numberOfLines={1}>{c}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.formatRow}>
                <View style={styles.formatCell}><Text style={styles.formatCellText}>124AD0041</Text></View>
                <View style={styles.formatCell}><Text style={styles.formatCellText}>18</Text></View>
                <View style={styles.formatCell}><Text style={styles.formatCellText}>27</Text></View>
                {courseCols.length > 3 && <View style={styles.formatCell}><Text style={styles.formatCellText}>45</Text></View>}
              </View>
            </View>

            <TouchableOpacity style={styles.uploadBox} onPress={handleSelectExcel} disabled={isRunning}>
              <FileSpreadsheet size={24} color={Colors.dark.textSecondary} style={{ marginBottom: 8 }} />
              <Text style={styles.uploadText}>{excelFile ? excelFile.name : 'Tap to select Complete Course Excel'}</Text>
            </TouchableOpacity>
            {excelFile && (
               <TouchableOpacity style={[styles.submitBtn, isRunning && styles.disabled]} onPress={handleCourseExcelUpload} disabled={isRunning}>
                 {isRunning ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Upload Course Marks</Text>}
               </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.infoBox}>
            <AlertCircle size={16} color={Colors.dark.primary} style={{ marginRight: 8 }} />
            <Text style={styles.infoText}>Custom exams must use exam-level Excel upload.</Text>
          </View>
        )}

        {/* List of Exams */}
        <Text style={[styles.sectionTitle, { marginTop: Spacing.four }]}>Exams under {selectedGroup.courseCode}</Text>
        <View style={{ gap: 12, marginTop: 8 }}>
          {selectedGroup.exams.map(exam => (
            <TouchableOpacity key={exam.id} style={styles.card} onPress={() => { setSelectedExam(exam); setExcelFile(null); setFiles([]); }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{exam.title}</Text>
                <Text style={styles.cardInfo}>{exam.exam_type ? exam.exam_type.toUpperCase() : 'CUSTOM'} • {exam.total_marks} Marks</Text>
              </View>
              <ChevronRight size={20} color={Colors.dark.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

  // 3. Exam Evaluation (PDF vs Exam-Level Excel)
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: Colors.dark.background }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity style={styles.backBtn} onPress={() => setSelectedExam(null)}>
          <ChevronLeft size={20} color={Colors.dark.textSecondary} />
          <Text style={styles.backText}>Back to {selectedGroup.courseCode}</Text>
        </TouchableOpacity>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{selectedExam.title}</Text>
          <Text style={styles.subText}>Evaluation setup for {selectedExam.total_marks} marks</Text>
        </View>

        <View style={styles.toggleContainer}>
          <TouchableOpacity style={[styles.toggleBtn, mode === 'ai' && styles.toggleBtnActive]} onPress={() => setMode('ai')}>
            <Bot size={16} color={mode === 'ai' ? '#fff' : Colors.dark.textSecondary} />
            <Text style={[styles.toggleText, mode === 'ai' && styles.toggleTextActive]}>AI Evaluation</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toggleBtn, mode === 'excel' && styles.toggleBtnActive]} onPress={() => setMode('excel')}>
            <FileSpreadsheet size={16} color={mode === 'excel' ? '#fff' : Colors.dark.textSecondary} />
            <Text style={[styles.toggleText, mode === 'excel' && styles.toggleTextActive]}>Excel Upload</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.uploadSection}>
          {mode === 'ai' ? (
            <>
              <Text style={styles.label}>Question Paper (MANDATORY)</Text>
              <TextInput style={[styles.input, { height: 100 }]} placeholder="Paste the exam question paper..." placeholderTextColor={Colors.dark.textSecondary} multiline value={questionPaper} onChangeText={setQuestionPaper} />
              
              <Text style={[styles.label, { marginTop: Spacing.two }]}>Marking Scheme / Rubric (MANDATORY)</Text>
              <TextInput style={[styles.input, { height: 100 }]} placeholder="Paste the detailed grading rubric..." placeholderTextColor={Colors.dark.textSecondary} multiline value={rubric} onChangeText={setRubric} />

              <Text style={[styles.label, { marginTop: Spacing.four }]}>Answer Scripts (PDFs)</Text>
              <TouchableOpacity style={styles.uploadBox} onPress={handleSelectFiles} disabled={isRunning}>
                <Upload size={24} color={Colors.dark.textSecondary} style={{ marginBottom: 8 }} />
                <Text style={styles.uploadText}>Tap to select multiple PDFs</Text>
              </TouchableOpacity>

              {files.length > 0 && (
                <View style={styles.fileListContainer}>
                  {files.map(f => (
                    <View key={f.id} style={styles.fileRow}>
                      <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                      {f.state === 'done' ? <CheckCircle size={14} color={Colors.dark.success} /> : f.state === 'error' ? <X size={14} color={Colors.dark.error} /> : f.state === 'pending' ? <FileText size={14} color={Colors.dark.textSecondary} /> : <ActivityIndicator size="small" color={Colors.dark.primary} />}
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity style={[styles.submitBtn, (!questionPaper.trim() || !rubric.trim() || files.length === 0 || isRunning) && styles.disabled]} onPress={handleStartBatchEvaluation} disabled={!questionPaper.trim() || !rubric.trim() || files.length === 0 || isRunning}>
                {isRunning ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Start AI Evaluation ({files.length} scripts)</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>Exam Excel Upload</Text>
              <Text style={styles.helperText}>Upload one Excel sheet with marks for this exam only.</Text>

              <View style={[styles.formatBox, { marginBottom: 16 }]}>
                <Text style={styles.formatTitle}>Expected Columns (Exactly 2 Columns):</Text>
                <View style={styles.formatRow}>
                  <View style={[styles.formatHeader, { flex: 1 }]}><Text style={styles.formatHeaderText}>Roll Number</Text></View>
                  <View style={[styles.formatHeader, { flex: 1 }]}><Text style={styles.formatHeaderText}>Marks</Text></View>
                </View>
                <View style={styles.formatRow}>
                  <View style={[styles.formatCell, { flex: 1 }]}><Text style={styles.formatCellText}>124AD0041</Text></View>
                  <View style={[styles.formatCell, { flex: 1 }]}><Text style={styles.formatCellText}>17</Text></View>
                </View>
              </View>

              <TouchableOpacity style={styles.uploadBox} onPress={handleSelectExcel} disabled={isRunning}>
                <FileSpreadsheet size={24} color={Colors.dark.textSecondary} style={{ marginBottom: 8 }} />
                <Text style={styles.uploadText}>{excelFile ? excelFile.name : 'Tap to select Exam Excel'}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={[styles.submitBtn, (!excelFile || isRunning) && styles.disabled]} onPress={handleExamExcelUpload} disabled={!excelFile || isRunning}>
                {isRunning ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Upload Exam Marks</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  scrollContent: { padding: Spacing.three, paddingBottom: Spacing.six },
  header: { marginBottom: Spacing.four },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.dark.text },
  subText: { fontSize: 13, color: Colors.dark.textSecondary, marginTop: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.three },
  backText: { fontSize: 14, color: Colors.dark.textSecondary, marginLeft: 4 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  },
  cardIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(235, 94, 40, 0.1)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: Colors.dark.text },
  cardSubTitle: { fontSize: 14, color: Colors.dark.textSecondary, marginTop: 2 },
  cardInfo: { fontSize: 12, color: Colors.dark.primary, marginTop: 6, fontWeight: '500' },
  uploadSection: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 18,
    padding: Spacing.three,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginTop: Spacing.two,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: Colors.dark.text },
  label: { fontSize: 13, fontWeight: '600', color: Colors.dark.text, marginBottom: 8 },
  helperText: { fontSize: 12, color: Colors.dark.textSecondary, marginBottom: 12 },
  input: { backgroundColor: Colors.dark.surfaceLight, borderWidth: 1, borderColor: Colors.dark.border, borderRadius: 10, padding: 12, color: Colors.dark.text, fontSize: 13, fontFamily: Fonts.mono, textAlignVertical: 'top', marginBottom: 12 },
  uploadBox: { backgroundColor: Colors.dark.surfaceLight, borderWidth: 1, borderColor: Colors.dark.border, borderStyle: 'dashed', borderRadius: 12, height: 100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  uploadText: { fontSize: 12, color: Colors.dark.textSecondary },
  submitBtn: { backgroundColor: Colors.dark.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  toggleContainer: { flexDirection: 'row', backgroundColor: Colors.dark.surface, borderRadius: 12, padding: 4, marginBottom: Spacing.four, borderWidth: 1, borderColor: Colors.dark.border },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8, gap: 8 },
  toggleBtnActive: { backgroundColor: Colors.dark.primary },
  toggleText: { fontSize: 13, fontWeight: '600', color: Colors.dark.textSecondary },
  toggleTextActive: { color: '#fff' },
  fileListContainer: { borderWidth: 1, borderColor: Colors.dark.border, borderRadius: 10, overflow: 'hidden', marginBottom: 16 },
  fileRow: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: Colors.dark.surfaceLight, borderBottomWidth: 1, borderBottomColor: Colors.dark.border },
  fileName: { fontSize: 12, color: Colors.dark.text, flex: 1, marginRight: 10 },
  infoBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(235, 94, 40, 0.05)', borderWidth: 1, borderColor: 'rgba(235, 94, 40, 0.2)', padding: 12, borderRadius: 10, marginBottom: 16 },
  infoText: { fontSize: 12, color: Colors.dark.textSecondary, flex: 1 },
  formatBox: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: Colors.dark.border, marginBottom: 16 },
  formatTitle: { fontSize: 11, fontWeight: '600', color: '#4ade80', marginBottom: 8 },
  formatRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#333' },
  formatHeader: { flex: 1, paddingVertical: 6, alignItems: 'center' },
  formatHeaderText: { fontSize: 10, fontWeight: '700', color: Colors.dark.textSecondary },
  formatCell: { flex: 1, paddingVertical: 6, alignItems: 'center' },
  formatCellText: { fontSize: 10, fontFamily: Fonts.mono, color: Colors.dark.text }
});
