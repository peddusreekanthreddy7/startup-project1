import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, TextInput, Alert, Modal, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import GlobalHeader from '../../components/GlobalHeader';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { FileText, ArrowLeft, Search, ChevronRight, User, Award, CheckCircle, Clock, BookOpen, AlertCircle, Eye, EyeOff, Edit, Check, Sparkles, X, ExternalLink } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { openBrowserAsync } from 'expo-web-browser';

type Exam = {
  id: string;
  title: string;
  subject: string;
  total_marks: number;
  exam_date: string | null;
};

type ScriptListItem = {
  id: string;
  status: string;
  total_awarded: number | null;
  evaluated_at: string | null;
  roll_number: string | null;
  student: {
    id: string;
    full_name: string;
    roll_number: string;
    email: string;
    branch: string | null;
    year: string | null;
    section: string | null;
  } | null;
};

type Question = {
  id: string;
  qno: string;
  max_marks: number;
  awarded_marks: number;
  verdict: 'correct' | 'partial' | 'wrong';
  ai_feedback: string;
  correct_approach: string | null;
  student_answer: string | null;
};

export default function ScriptsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { scriptId, examId } = useLocalSearchParams<{ scriptId?: string; examId?: string }>();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Navigation states
  const [currentView, setCurrentView] = useState<'exams' | 'scripts' | 'detail'>('exams');
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);

  // Data states
  const [exams, setExams] = useState<Exam[]>([]);
  const [scripts, setScripts] = useState<ScriptListItem[]>([]);
  const [scriptDetail, setScriptDetail] = useState<{
    id: string;
    total_awarded: number | null;
    pdf_path: string | null;
    roll_number: string | null;
    exam?: Exam | null;
    student: ScriptListItem['student'];
    questions: Question[];
  } | null>(null);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [showTranscription, setShowTranscription] = useState(true);
  const [editingQId, setEditingQId] = useState<string | null>(null);
  const [editingMarks, setEditingMarks] = useState('');
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const fetchExams = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('exams')
        .select('id, title, subject, total_marks, exam_date')
        .eq('created_by', user.id)
        .order('exam_date', { ascending: false });

      if (error) throw error;
      setExams(data ?? []);
    } catch (err) {
      console.error('Error fetching exams:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchScripts = async (examId: string) => {
    setLoading(true);
    try {
      // Fetch scripts with active profiles
      const { data: scriptsData, error: scriptsErr } = await supabase
        .from('answer_scripts')
        .select(`
          id, status, total_awarded, evaluated_at, roll_number, student_id,
          student:profiles!answer_scripts_student_id_fkey(id, full_name, roll_number, email, branch, year, section)
        `)
        .eq('exam_id', examId)
        .eq('status', 'evaluated')
        .order('evaluated_at', { ascending: false });

      if (scriptsErr) throw scriptsErr;

      // Fetch orphan scripts (null student_id)
      const { data: orphansData, error: orphansErr } = await supabase
        .from('answer_scripts')
        .select(`
          id, status, total_awarded, evaluated_at, roll_number, student_id
        `)
        .eq('exam_id', examId)
        .eq('status', 'evaluated')
        .is('student_id', null);

      if (orphansErr) throw orphansErr;

      const merged = [
        ...(scriptsData ?? []),
        ...(orphansData ?? []).map((o) => ({ ...o, student: null })),
      ] as unknown as ScriptListItem[];

      setScripts(merged);
    } catch (err) {
      console.error('Error fetching scripts:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchScriptDetail = async (scriptId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('answer_scripts')
        .select(`
          id,
          total_awarded,
          pdf_path,
          roll_number,
          exam:exams!exam_id(id, title, total_marks, subject),
          student:profiles!student_id(id, full_name, roll_number, email, branch, year, section),
          questions:script_questions(
            id, qno, max_marks, awarded_marks, verdict, ai_feedback, correct_approach, student_answer
          )
        `)
        .eq('id', scriptId)
        .single();

      if (error) throw error;

      if (data?.exam) {
        setSelectedExam(data.exam as any);
      }

      // Sort questions numerically
      if (data?.questions) {
        data.questions.sort((a: any, b: any) => a.qno.localeCompare(b.qno, undefined, { numeric: true }));
      }

      setScriptDetail(data as any);
    } catch (err) {
      console.error('Error fetching script detail:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await fetchExams();
      if (scriptId) {
        setSelectedScriptId(scriptId);
        setCurrentView('detail');
        await fetchScriptDetail(scriptId);
      } else if (examId) {
        try {
          const { data, error } = await supabase
            .from('exams')
            .select('id, title, subject, total_marks, exam_date')
            .eq('id', examId)
            .single();
          if (data && !error) {
            setSelectedExam(data);
            setCurrentView('scripts');
            await fetchScripts(examId);
          }
        } catch (err) {
          console.error(err);
        }
      }
    };
    if (user) {
      init();
    }
  }, [user, scriptId, examId]);

  const onRefresh = () => {
    setRefreshing(true);
    if (currentView === 'exams') {
      fetchExams();
    } else if (currentView === 'scripts' && selectedExam) {
      fetchScripts(selectedExam.id);
    } else if (currentView === 'detail' && selectedScriptId) {
      fetchScriptDetail(selectedScriptId);
    }
  };

  const handleSelectExam = (exam: Exam) => {
    setSelectedExam(exam);
    setCurrentView('scripts');
    fetchScripts(exam.id);
  };

  const handleSelectScript = (scriptId: string) => {
    setSelectedScriptId(scriptId);
    setCurrentView('detail');
    fetchScriptDetail(scriptId);
  };

  const handleBackToExams = () => {
    setSelectedExam(null);
    setCurrentView('exams');
  };

  const handleBackToScripts = () => {
    setSelectedScriptId(null);
    setScriptDetail(null);
    setCurrentView('scripts');
    if (selectedExam) {
      fetchScripts(selectedExam.id);
    }
  };

  const handleViewPdf = async () => {
    if (!scriptDetail?.pdf_path) {
      Alert.alert('No PDF', 'There is no PDF associated with this script.');
      return;
    }
    
    try {
      setLoading(true);
      const { data, error } = await supabase.storage
        .from('answer-scripts')
        .createSignedUrl(scriptDetail.pdf_path, 3600);
        
      if (error) throw error;
      
      await openBrowserAsync(data.signedUrl);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load PDF');
    } finally {
      setLoading(false);
    }
  };

  const startEditQuestion = (q: Question) => {
    setEditingQId(q.id);
    setEditingMarks(String(q.awarded_marks));
  };

  const saveQuestionMarks = async (q: Question) => {
    const score = parseFloat(editingMarks);
    if (isNaN(score) || score < 0 || score > q.max_marks) {
      Alert.alert('Invalid Marks', `Please input a number between 0 and ${q.max_marks}`);
      return;
    }

    try {
      setLoading(true);
      // Update marks
      const verdict = score === q.max_marks ? 'correct' : score > 0 ? 'partial' : 'wrong';
      const { error: qErr } = await supabase
        .from('script_questions')
        .update({ awarded_marks: score, verdict })
        .eq('id', q.id);

      if (qErr) throw qErr;

      // Update script's total_awarded sum
      if (scriptDetail) {
        const updatedQuestions = scriptDetail.questions.map((item) => 
          item.id === q.id ? { ...item, awarded_marks: score, verdict } : item
        );
        const newTotal = updatedQuestions.reduce((sum, item) => sum + item.awarded_marks, 0);

        const { error: sErr } = await supabase
          .from('answer_scripts')
          .update({ total_awarded: newTotal })
          .eq('id', scriptDetail.id);

        if (sErr) throw sErr;
      }

      setEditingQId(null);
      if (selectedScriptId) {
        await fetchScriptDetail(selectedScriptId);
      }
      Alert.alert('Success', 'Marks updated successfully!');
    } catch (err: any) {
      Alert.alert('Save Failed', err.message || 'Error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const getVerdictBadgeColor = (verdict: string) => {
    if (verdict === 'correct') return { bg: 'rgba(16, 185, 129, 0.1)', txt: Colors.dark.success, label: 'Correct' };
    if (verdict === 'partial') return { bg: 'rgba(245, 158, 11, 0.1)', txt: Colors.dark.warning, label: 'Partial' };
    return { bg: 'rgba(239, 68, 68, 0.1)', txt: Colors.dark.error, label: 'Incorrect' };
  };

  const filteredScripts = scripts.filter((s) => {
    const studentName = s.student?.full_name ?? s.roll_number ?? '';
    const roll = s.student?.roll_number ?? s.roll_number ?? '';
    const q = searchQuery.toLowerCase();
    return studentName.toLowerCase().includes(q) || roll.toLowerCase().includes(q);
  });

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {currentView === 'exams' && <GlobalHeader role="teacher" title="Answer Scripts" />}
      {/* HEADER ACTIONS */}
      {currentView === 'scripts' && (
        <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.dark.surface }}>
          <View style={styles.subHeader}>
            <TouchableOpacity style={styles.backBtn} onPress={handleBackToExams}>
              <ArrowLeft size={16} color={Colors.dark.textSecondary} style={{ marginRight: 6 }} />
              <Text style={styles.backBtnText}>Exams</Text>
            </TouchableOpacity>
            <Text style={styles.subHeaderTitle} numberOfLines={1}>{selectedExam?.title}</Text>
          </View>
        </SafeAreaView>
      )}

      {currentView === 'detail' && (
        <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.dark.surface }}>
          <View style={styles.subHeader}>
            <TouchableOpacity style={styles.backBtn} onPress={handleBackToScripts}>
              <ArrowLeft size={16} color={Colors.dark.textSecondary} style={{ marginRight: 6 }} />
              <Text style={styles.backBtnText}>Scripts</Text>
            </TouchableOpacity>
            <Text style={styles.subHeaderTitle} numberOfLines={1}>
              {scriptDetail?.student?.full_name ?? scriptDetail?.student?.roll_number ?? 'Graded Script'}
            </Text>
          </View>
        </SafeAreaView>
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />
        }
      >
        {/* VIEW 1: EXAMS LIST */}
        {currentView === 'exams' && (
          <View>
            <View style={{ marginBottom: Spacing.four }}>
              <Text style={styles.title}>Evaluations Center</Text>
              <Text style={styles.subtitle}>Select an exam component to manage submitted student script evaluations</Text>
            </View>

            {exams.length > 0 ? (
              <View style={styles.listContainer}>
                {exams.map((exam) => {
                  const dateStr = exam.exam_date
                    ? new Date(exam.exam_date).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : 'No Date Set';

                  return (
                    <TouchableOpacity
                      key={exam.id}
                      style={styles.card}
                      onPress={() => handleSelectExam(exam)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>{exam.title}</Text>
                        <Text style={styles.cardSubtitle}>
                          {exam.subject} • {dateStr}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={styles.totalBadge}>
                          <Text style={styles.totalBadgeText}>{exam.total_marks} Marks</Text>
                        </View>
                        <ChevronRight size={16} color={Colors.dark.textSecondary} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <FileText size={38} color={Colors.dark.textSecondary} />
                <Text style={styles.emptyTitle}>No exams created</Text>
                <Text style={styles.emptySubtitle}>You have not been assigned any examinations yet.</Text>
              </View>
            )}
          </View>
        )}

        {/* VIEW 2: SCRIPTS LIST */}
        {currentView === 'scripts' && (
          <View>
            {/* Search Bar */}
            <View style={styles.searchBox}>
              <Search size={16} color={Colors.dark.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search student or roll number..."
                placeholderTextColor="#5a5856"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            {filteredScripts.length > 0 ? (
              <View style={styles.listContainer}>
                {filteredScripts.map((s) => {
                  const studentName = s.student?.full_name ?? s.roll_number ?? 'Unknown';
                  const roll = s.student?.roll_number ?? s.roll_number ?? 'N/A';
                  
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={styles.scriptRow}
                      onPress={() => handleSelectScript(s.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.studentName}>{studentName}</Text>
                        <Text style={styles.studentRoll}>{roll}</Text>
                      </View>
                      <View style={styles.scoreContainer}>
                        <Text style={styles.scoreText}>
                          {s.total_awarded != null ? s.total_awarded : '—'}
                          <Text style={{ fontSize: 9, color: Colors.dark.textSecondary }}>
                            /{selectedExam?.total_marks}
                          </Text>
                        </Text>
                      </View>
                      <ChevronRight size={14} color={Colors.dark.textSecondary} style={{ marginLeft: 8 }} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <Search size={28} color={Colors.dark.textSecondary} />
                <Text style={styles.emptyTitle}>No scripts matched</Text>
                <Text style={styles.emptySubtitle}>Verify spelling or check details for missing student entries.</Text>
              </View>
            )}
          </View>
        )}

        {/* VIEW 3: GRADER DETAIL VIEW */}
        {currentView === 'detail' && scriptDetail && (
          <View>
            {/* Student Profile / Script Card */}
            <View style={styles.profileCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <User size={18} color={Colors.dark.primary} style={{ marginRight: 8 }} />
                <Text style={styles.profileHeader}>Student Details</Text>
              </View>
              {scriptDetail.student ? (
                <View style={styles.profileGrid}>
                  <Text style={styles.profileLabel}>Name: <Text style={styles.profileVal}>{scriptDetail.student.full_name}</Text></Text>
                  <Text style={styles.profileLabel}>Roll No: <Text style={styles.profileVal}>{scriptDetail.student.roll_number}</Text></Text>
                  <Text style={styles.profileLabel}>Email: <Text style={styles.profileVal}>{scriptDetail.student.email}</Text></Text>
                  {scriptDetail.student.branch && (
                    <Text style={styles.profileLabel}>Branch: <Text style={styles.profileVal}>{scriptDetail.student.branch}</Text></Text>
                  )}
                </View>
              ) : (
                <View style={styles.profileGrid}>
                  <Text style={styles.profileLabel}>Roll No: <Text style={styles.profileVal}>{scriptDetail.roll_number || 'N/A'}</Text></Text>
                  <Text style={styles.profileLabel}>Status: <Text style={[styles.profileVal, { color: Colors.dark.warning }]}>Not registered (Orphan)</Text></Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity
                  style={[styles.toggleBtn, showTranscription && styles.toggleActiveBtn, { flex: 1 }]}
                  onPress={() => setShowTranscription(!showTranscription)}
                >
                  <Text style={styles.toggleBtnText}>
                    {showTranscription ? 'Hide Extracted Text' : 'Show Extracted Text'}
                  </Text>
                </TouchableOpacity>
                
                {scriptDetail.pdf_path && (
                  <TouchableOpacity
                    style={[styles.toggleBtn, { flex: 1, backgroundColor: Colors.dark.primary }]}
                    onPress={handleViewPdf}
                  >
                    <Text style={[styles.toggleBtnText, { color: '#fff' }]}>
                      View PDF Script
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Questions List */}
            <View style={{ gap: Spacing.three }}>
              {scriptDetail.questions.map((q) => {
                const badge = getVerdictBadgeColor(q.verdict);
                const isEditing = editingQId === q.id;

                return (
                  <View key={q.id} style={styles.questionCard}>
                    {/* Header */}
                    <View style={styles.qHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={styles.qNumber}>Question {q.qno}</Text>
                        <View style={[styles.verdictBadge, { backgroundColor: badge.bg }]}>
                          <Text style={[styles.verdictBadgeText, { color: badge.txt }]}>{badge.label}</Text>
                        </View>
                      </View>

                      {isEditing ? (
                        <View style={styles.editScoreForm}>
                          <TextInput
                            style={styles.editInput}
                            keyboardType="numeric"
                            value={editingMarks}
                            onChangeText={setEditingMarks}
                          />
                          <TouchableOpacity 
                            style={styles.saveScoreBtn}
                            onPress={() => saveQuestionMarks(q)}
                          >
                            <Check size={14} color={Colors.dark.text} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Text style={styles.qScore}>
                            {q.awarded_marks}
                            <Text style={{ fontSize: 10, color: Colors.dark.textSecondary }}>/{q.max_marks}</Text>
                          </Text>
                          <TouchableOpacity onPress={() => startEditQuestion(q)}>
                            <Edit size={13} color={Colors.dark.primary} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>

                    {/* AI Feedback */}
                    <View style={styles.feedbackSection}>
                      <Text style={styles.sectionHeading}>AI FEEDBACK</Text>
                      <Text style={styles.feedbackText}>{q.ai_feedback}</Text>
                    </View>

                    {/* Ideal Approach */}
                    {q.correct_approach && (
                      <View style={styles.approachSection}>
                        <Text style={[styles.sectionHeading, { color: Colors.dark.success }]}>IDEAL APPROACH</Text>
                        <Text style={styles.approachText}>{q.correct_approach}</Text>
                      </View>
                    )}

                    {/* Extracted Answer */}
                    {showTranscription && q.student_answer && (
                      <View style={styles.transcriptionSection}>
                        <Text style={[styles.sectionHeading, { color: Colors.dark.primary }]}>EXTRACTED STUDENT ANSWER</Text>
                        <Text style={styles.transcriptionText}>{q.student_answer}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      {/* PDF Viewer Modal */}
      <Modal visible={showPdfViewer} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.dark.surface }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowPdfViewer(false)} style={styles.closeBtn}>
              <X size={20} color={Colors.dark.text} />
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle} numberOfLines={1}>Original Script</Text>
            <TouchableOpacity 
              onPress={() => pdfUrl && Linking.openURL(pdfUrl)} 
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 }}
            >
              <ExternalLink size={15} color={Colors.dark.primary} />
              <Text style={{ fontSize: 12, color: Colors.dark.primary, fontWeight: '600' }}>Open</Text>
            </TouchableOpacity>
          </View>
          {pdfUrl ? (
            <WebView
              source={{ uri: Platform.OS === 'android' ? `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(pdfUrl)}` : pdfUrl }}
              style={{ flex: 1 }}
              startInLoadingState
              renderLoading={() => (
                <ActivityIndicator
                  color={Colors.dark.primary}
                  size="large"
                  style={{ position: 'absolute', top: '50%', left: '50%', marginLeft: -18, marginTop: -18 }}
                />
              )}
            />
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color={Colors.dark.primary} size="large" />
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    marginRight: 12,
  },
  backBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  subHeaderTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  scrollContent: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 4,
  },
  listContainer: {
    gap: Spacing.two,
  },
  newEvalBtn: {
    backgroundColor: Colors.dark.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    borderRadius: 16,
    marginBottom: Spacing.four,
  },
  newEvalBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  card: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  cardSubtitle: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
    marginTop: 4,
  },
  totalBadge: {
    backgroundColor: Colors.dark.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  totalBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  emptySubtitle: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: Spacing.three,
  },
  searchInput: {
    flex: 1,
    fontSize: 12.5,
    color: Colors.dark.text,
    padding: 0,
  },
  scriptRow: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  studentName: {
    fontSize: 13.5,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  studentRoll: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  scoreContainer: {
    backgroundColor: Colors.dark.surfaceLight,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 50,
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  profileCard: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    marginBottom: Spacing.four,
  },
  profileHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  profileGrid: {
    gap: 6,
    marginBottom: 8,
  },
  profileLabel: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  profileVal: {
    color: Colors.dark.text,
    fontWeight: '500',
  },
  toggleBtn: {
    backgroundColor: Colors.dark.surfaceLight,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  toggleActiveBtn: {
    backgroundColor: 'rgba(235, 94, 40, 0.12)',
  },
  toggleBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  questionCard: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
  },
  qHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    paddingBottom: Spacing.two,
    marginBottom: Spacing.two,
  },
  qNumber: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  verdictBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    marginLeft: 8,
  },
  verdictBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  qScore: {
    fontSize: 13,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  editScoreForm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editInput: {
    backgroundColor: Colors.dark.surfaceLight,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 6,
    width: 42,
    textAlign: 'center',
    paddingVertical: 2,
    paddingHorizontal: 4,
    fontSize: 12,
    color: Colors.dark.text,
    fontFamily: Fonts.mono,
  },
  saveScoreBtn: {
    backgroundColor: Colors.dark.primary,
    padding: 6,
    borderRadius: 6,
  },
  sectionHeading: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.dark.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  feedbackSection: {
    marginBottom: Spacing.two,
  },
  feedbackText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  approachSection: {
    borderLeftWidth: 2,
    borderLeftColor: Colors.dark.success,
    paddingLeft: Spacing.two,
    marginBottom: Spacing.two,
  },
  approachText: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
    lineHeight: 17,
  },
  transcriptionSection: {
    backgroundColor: Colors.dark.surfaceLight,
    borderRadius: 10,
    padding: 10,
    marginTop: Spacing.two,
  },
  transcriptionText: {
    fontSize: 11.5,
    color: Colors.dark.text,
    lineHeight: 17,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    backgroundColor: Colors.dark.surface,
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 80,
  },
  closeBtnText: {
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
    flex: 1,
    textAlign: 'center',
  },
});
