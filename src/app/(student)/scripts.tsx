import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Modal, TextInput, Linking, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import GlobalHeader from '../../components/GlobalHeader';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { FileText, ChevronRight, CheckCircle, AlertCircle, MessageSquare, ArrowLeft, Send, ExternalLink, X } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import { openBrowserAsync } from 'expo-web-browser';

type Question = {
  id: string;
  qno: string;
  max_marks: number;
  awarded_marks: number;
  verdict: 'correct' | 'partial' | 'wrong';
  ai_feedback: string;
  correct_approach: string;
  student_answer: string | null;

  // New VLM fields
  feedback?: string | null;
  formulas?: string[] | null;
  tables?: string[] | null;
  diagram_description?: string | null;
};

type Script = {
  id: string;
  status: string;
  total_awarded: number | null;
  evaluated_at: string | null;
  pdf_path: string | null;
  exam: {
    id: string;
    title: string;
    subject: string;
    total_marks: number;
    exam_date: string | null;
  } | null;
  questions: Question[];

  // New VLM fields
  overall_feedback: string | null;
  audit_trail: string | null;
};

export default function ScriptsScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);

  // PDF Viewer Modal State
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // Objection form modal state
  const [isObjectionOpen, setIsObjectionOpen] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<Question | null>(null);
  const [objectionText, setObjectionText] = useState('');
  const [submittingObjection, setSubmittingObjection] = useState(false);
  const [objections, setObjections] = useState<any[]>([]);

  const fetchScripts = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('answer_scripts')
        .select(`
          id,
          status,
          total_awarded,
          evaluated_at,
          pdf_path,
          overall_feedback,
          audit_trail,
          exam:exams!exam_id(
            id,
            title,
            subject,
            total_marks,
            exam_date
          ),
          questions:script_questions(
            id,
            qno,
            max_marks,
            awarded_marks,
            verdict,
            ai_feedback,
            correct_approach,
            student_answer,
            feedback,
            formulas,
            tables,
            diagram_description
          )
        `)
        .eq('student_id', user.id)
        .order('evaluated_at', { ascending: false });

      if (error) throw error;
      const formatted = (data as unknown as Script[]) ?? [];
      setScripts(formatted);

      const { data: objData } = await supabase
        .from('paper_objections')
        .select('id, script_id, qno, status, text, updated_marks')
        .eq('student_id', user.id);
      setObjections(objData ?? []);

      // Refresh active script if detail is open
      if (selectedScript) {
        const fresh = formatted.find((s) => s.id === selectedScript.id);
        if (fresh) setSelectedScript(fresh);
      }
    } catch (err) {
      console.error('Error fetching student scripts:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchScripts();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchScripts();
  };

  const handleOpenPdf = async (pdfPath: string | null) => {
    if (!pdfPath) {
      Alert.alert('PDF Not Available', 'Answer script PDF was not stored for this exam.');
      return;
    }

    try {
      const { data, error } = await supabase.storage
        .from('answer-scripts')
        .createSignedUrl(pdfPath, 60 * 60);

      if (error || !data?.signedUrl) {
        throw new Error(error?.message || 'Failed to sign storage URL');
      }

      await openBrowserAsync(data.signedUrl);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not open PDF file.');
    }
  };

  const handleOpenObjection = (q: Question) => {
    if (!selectedScript || !user) return;
    const existing = objections.find(o => o.script_id === selectedScript.id && o.qno === q.qno);
    setActiveQuestion(q);
    setObjectionText(existing ? existing.text : '');
    if (existing) {
      if (existing.status !== 'sent') {
        Alert.alert(
          'Dispute Resolved',
          `The dispute for Question ${q.qno} has already been processed (Status: ${existing.status}). Modifying resolved disputes is not allowed.`,
          [{ text: 'OK', style: 'default' }]
        );
      } else {
        Alert.alert(
          'Pending Dispute',
          `You have a pending dispute for Question ${q.qno}. Would you like to edit your submission?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Edit Reason', onPress: () => setIsObjectionOpen(true) }
          ]
        );
      }
    } else {
      setIsObjectionOpen(true);
    }
  };

  const handleSubmitObjection = async () => {
    if (!selectedScript || !activeQuestion || !objectionText.trim() || !user) return;
    setSubmittingObjection(true);

    try {
      const existing = objections.find(o => o.script_id === selectedScript.id && o.qno === activeQuestion.qno);
      
      const payload: any = {
        script_id: selectedScript.id,
        student_id: user.id,
        qno: activeQuestion.qno,
        text: objectionText.trim(),
        status: 'sent',
        raised_at: new Date().toISOString(),
      };
      
      if (existing?.id) {
        payload.id = existing.id;
      }

      const { error } = await supabase
        .from('paper_objections')
        .upsert(payload, {
          onConflict: 'script_id,student_id,qno'
        });

      if (error) throw error;
      
      Alert.alert(
        'Dispute Submitted',
        existing
          ? `Your dispute for Question ${activeQuestion.qno} has been updated successfully.`
          : `Your dispute for Question ${activeQuestion.qno} has been submitted successfully.`
      );
      setIsObjectionOpen(false);
      fetchScripts();
    } catch (err: any) {
      Alert.alert('Submission Failed', err.message || 'An error occurred.');
    } finally {
      setSubmittingObjection(false);
    }
  };

  const getVerdictStyle = (verdict: string) => {
    if (verdict === 'correct') return { bg: 'rgba(16, 185, 129, 0.1)', text: Colors.dark.success };
    if (verdict === 'partial') return { bg: 'rgba(245, 158, 11, 0.1)', text: Colors.dark.warning };
    return { bg: 'rgba(239, 68, 68, 0.1)', text: Colors.dark.error };
  };

  const evaluated = scripts.filter((s) => s.status === 'evaluated');
  const pending = scripts.filter((s) => s.status !== 'evaluated');

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  if (selectedScript) {
    const pct = selectedScript.total_awarded != null && selectedScript.exam
      ? Math.round((selectedScript.total_awarded / selectedScript.exam.total_marks) * 100)
      : null;

    const sortedQuestions = [...selectedScript.questions].sort((a, b) => 
      a.qno.localeCompare(b.qno, undefined, { numeric: true })
    );

    return (
      <View style={styles.container}>
        {/* Detail Header */}
        <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.dark.surface }}>
          <View style={styles.detailHeader}>
            <TouchableOpacity style={styles.backButton} onPress={() => setSelectedScript(null)}>
              <ArrowLeft size={20} color={Colors.dark.text} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.detailExamTitle}>{selectedScript.exam?.title}</Text>
              <Text style={styles.detailExamSubject}>{selectedScript.exam?.subject}</Text>
            </View>
            {pct != null && (
              <View style={styles.scoreContainer}>
                <Text style={styles.detailScore}>
                  {selectedScript.total_awarded}
                  <Text style={{ fontSize: 13, fontWeight: '400', color: Colors.dark.textSecondary }}>
                    /{selectedScript.exam?.total_marks}
                  </Text>
                </Text>
                <Text style={[styles.detailPercent, { color: pct >= 60 ? Colors.dark.success : Colors.dark.warning }]}>
                  {pct}%
                </Text>
              </View>
            )}
          </View>
        </SafeAreaView>

        <ScrollView contentContainerStyle={styles.detailScroll}>
          {/* PDF Opener Button */}
          <TouchableOpacity 
            style={styles.pdfButton}
            onPress={() => handleOpenPdf(selectedScript.pdf_path)}
          >
            <FileText size={18} color={Colors.dark.primary} style={{ marginRight: 8 }} />
            <Text style={styles.pdfButtonText}>Open Scanned Answer Script</Text>
            <ExternalLink size={14} color={Colors.dark.textSecondary} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>

          {/* Overall Feedback Card */}
          {selectedScript.overall_feedback ? (
            <View style={[styles.questionCard, { backgroundColor: 'rgba(235, 94, 40, 0.05)', borderColor: Colors.dark.primary, borderStyle: 'dashed' }]}>
              <Text style={[styles.questionNumber, { color: Colors.dark.primary, marginBottom: 6 }]}>Overall Summary & Feedback</Text>
              <Text style={styles.feedbackText}>{selectedScript.overall_feedback}</Text>
            </View>
          ) : null}

          {/* Evaluation title */}
          <View style={styles.sectionTitleRow}>
            <CheckCircle size={14} color={Colors.dark.success} style={{ marginRight: 6 }} />
            <Text style={styles.sectionTitle}>AI Evaluation Results</Text>
            <Text style={styles.sectionCount}>({sortedQuestions.length} questions)</Text>
          </View>

          {/* Question Breakdown List */}
          {sortedQuestions.length > 0 ? (
            sortedQuestions.map((q) => {
              const vs = getVerdictStyle(q.verdict);
              const displayFeedback = q.feedback || q.ai_feedback;
              return (
                <View key={q.id} style={styles.questionCard}>
                  <View style={styles.questionCardHeader}>
                    <View>
                      <Text style={styles.questionNumber}>Question {q.qno}</Text>
                      <View style={[styles.verdictBadge, { backgroundColor: vs.bg }]}>
                        <Text style={[styles.verdictText, { color: vs.text }]}>
                          {q.awarded_marks}/{q.max_marks} marks ({q.verdict})
                        </Text>
                      </View>
                    </View>

                    <TouchableOpacity 
                      style={styles.objectButton}
                      onPress={() => handleOpenObjection(q)}
                    >
                      <MessageSquare size={13} color={Colors.dark.primary} style={{ marginRight: 4 }} />
                      <Text style={styles.objectButtonText}>Object</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.questionCardBody}>
                    {displayFeedback ? (
                      <View>
                        <Text style={styles.feedbackLabel}>AI Feedback:</Text>
                        <Text style={styles.feedbackText}>{displayFeedback}</Text>
                      </View>
                    ) : null}

                    {/* OCR Answer transcription verification box */}
                    {(q.student_answer || q.formulas?.length || q.tables?.length || q.diagram_description) ? (
                      <View style={styles.studentAnswerBox}>
                        <Text style={styles.idealLabel}>AI Transcribed Answer:</Text>
                        {q.student_answer ? (
                          <Text style={styles.feedbackText}>"{q.student_answer}"</Text>
                        ) : null}
                        {q.formulas && q.formulas.length > 0 ? (
                          <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: Colors.dark.border, paddingTop: 6 }}>
                            <Text style={styles.idealLabel}>LaTeX Equations:</Text>
                            {q.formulas.map((f, idx) => (
                              <Text key={idx} style={{ fontFamily: Fonts.mono, fontSize: 11, color: Colors.dark.primary, marginTop: 2 }}>
                                {f}
                              </Text>
                            ))}
                          </View>
                        ) : null}
                        {q.tables && q.tables.length > 0 ? (
                          <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: Colors.dark.border, paddingTop: 6 }}>
                            <Text style={styles.idealLabel}>Tables:</Text>
                            {q.tables.map((t, idx) => (
                              <Text key={idx} style={{ fontFamily: Fonts.mono, fontSize: 10, color: Colors.dark.textSecondary, marginTop: 2 }}>
                                {t}
                              </Text>
                            ))}
                          </View>
                        ) : null}
                        {q.diagram_description ? (
                          <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: Colors.dark.border, paddingTop: 6 }}>
                            <Text style={styles.idealLabel}>Diagram description:</Text>
                            <Text style={{ fontSize: 11, fontStyle: 'italic', color: Colors.dark.textSecondary }}>
                              {q.diagram_description}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    {(!q.student_answer && q.correct_approach) ? (
                      <View style={styles.idealApproachBox}>
                        <Text style={styles.idealLabel}>Correct Approach / Rubric:</Text>
                        <Text style={styles.idealText}>{q.correct_approach}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No question-by-question evaluations found.</Text>
            </View>
          )}
        </ScrollView>

        {/* Objection Form Overlay Modal */}
        <Modal
          visible={isObjectionOpen}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setIsObjectionOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>Raise Objection</Text>
                  <Text style={styles.modalSubtitle}>Q{activeQuestion?.qno} · Current Marks: {activeQuestion?.awarded_marks}/{activeQuestion?.max_marks}</Text>
                </View>
                <TouchableOpacity onPress={() => setIsObjectionOpen(false)}>
                  <X size={20} color={Colors.dark.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.modalBody}>
                <Text style={styles.modalLabel}>Explain why the evaluation is incorrect:</Text>
                <TextInput
                  style={styles.modalInput}
                  multiline={true}
                  numberOfLines={4}
                  placeholder="Describe your reasoning in detail (e.g. step 3 calculation was correct, formula was applied appropriately...)"
                  placeholderTextColor="#4A4745"
                  value={objectionText}
                  onChangeText={setObjectionText}
                />

                <TouchableOpacity
                  style={[styles.modalSubmitBtn, !objectionText.trim() && styles.disabledSubmit]}
                  onPress={handleSubmitObjection}
                  disabled={submittingObjection || !objectionText.trim()}
                >
                  {submittingObjection ? (
                    <ActivityIndicator size="small" color={Colors.dark.text} />
                  ) : (
                    <>
                      <Send size={14} color={Colors.dark.text} style={{ marginRight: 6 }} />
                      <Text style={styles.modalSubmitBtnText}>Submit Objection</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* PDF Viewer Modal */}
        <Modal visible={showPdfViewer} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={{ flex: 1, backgroundColor: Colors.dark.surface }}>
            <View style={styles.pdfModalHeader}>
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

  return (
    <View style={{ flex: 1, backgroundColor: Colors.dark.background }}>
      <GlobalHeader role="student" title="Answer Scripts" />
      <ScrollView 
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.titleText}>Answer Scripts</Text>
          <Text style={styles.subText}>Review AI evaluations, check rubrics, and raise objections</Text>
        </View>

      {/* Evaluated Scripts list */}
      <View style={styles.sectionHeaderRow}>
        <CheckCircle size={13} color={Colors.dark.success} style={{ marginRight: 6 }} />
        <Text style={styles.sectionHeaderText}>Evaluated ({evaluated.length})</Text>
      </View>

      {evaluated.length > 0 ? (
        <View style={styles.listContainer}>
          {evaluated.map((s) => {
            const pct = s.total_awarded != null && s.exam
              ? Math.round((s.total_awarded / s.exam.total_marks) * 100)
              : null;
            const evalDateStr = s.evaluated_at
              ? new Date(s.evaluated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
              : 'N/A';

            return (
              <TouchableOpacity 
                key={s.id} 
                style={styles.scriptCard}
                onPress={() => setSelectedScript(s)}
              >
                <View style={styles.scriptIcon}>
                  <FileText size={18} color={Colors.dark.primary} />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.scriptTitle}>{s.exam?.title}</Text>
                  <Text style={styles.scriptSub}>{s.exam?.subject} • Graded {evalDateStr}</Text>
                </View>

                {pct != null && (
                  <View style={{ alignItems: 'flex-end', marginRight: 4 }}>
                    <Text style={styles.scoreText}>
                      {s.total_awarded}
                      <Text style={styles.scoreTotalText}>/{s.exam?.total_marks}</Text>
                    </Text>
                    <Text style={[styles.pctText, { color: pct >= 60 ? Colors.dark.success : Colors.dark.warning }]}>
                      {pct}%
                    </Text>
                  </View>
                )}

                <ChevronRight size={16} color={Colors.dark.borderLight} />
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <FileText size={28} color={Colors.dark.textSecondary} style={{ marginBottom: 6 }} />
          <Text style={styles.emptyText}>No evaluated scripts yet</Text>
        </View>
      )}

      {/* Pending Evaluations list */}
      {pending.length > 0 ? (
        <>
          <View style={[styles.sectionHeaderRow, { marginTop: Spacing.four }]}>
            <AlertCircle size={13} color={Colors.dark.warning} style={{ marginRight: 6 }} />
            <Text style={styles.sectionHeaderText}>Pending Evaluation ({pending.length})</Text>
          </View>
          
          <View style={styles.listContainer}>
            {pending.map((s) => (
              <View key={s.id} style={[styles.scriptCard, { opacity: 0.65 }]}>
                <View style={[styles.scriptIcon, { backgroundColor: Colors.dark.surfaceLight }]}>
                  <FileText size={18} color={Colors.dark.textSecondary} />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.scriptTitle}>{s.exam?.title ?? 'Exam'}</Text>
                  <Text style={styles.scriptSub}>{s.exam?.subject} • Processing script scan</Text>
                </View>

                <View style={[styles.badge, { backgroundColor: Colors.dark.border }]}>
                  <Text style={[styles.badgeText, { color: Colors.dark.textSecondary }]}>Evaluating</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}
      {/* PDF Viewer Modal */}
      <Modal visible={showPdfViewer} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.dark.surface }}>
          <View style={styles.pdfModalHeader}>
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
    </ScrollView>
  </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  scrollContent: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: Spacing.four,
  },
  titleText: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  subText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContainer: {
    gap: Spacing.two,
  },
  scriptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
  },
  scriptIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(235, 94, 40, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.three,
  },
  scriptTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  scriptSub: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  scoreText: {
    fontSize: 14,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  scoreTotalText: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    fontWeight: '400',
    color: Colors.dark.textSecondary,
  },
  pctText: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '600',
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.five,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 16,
  },
  emptyText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontStyle: 'italic',
  },
  // Details View Styles
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
  },
  backButton: {
    padding: 4,
  },
  detailExamTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  detailExamSubject: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  scoreContainer: {
    alignItems: 'flex-end',
  },
  detailScore: {
    fontSize: 16,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  detailPercent: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  detailScroll: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
  },
  pdfButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(235, 94, 40, 0.08)',
    borderColor: 'rgba(235, 94, 40, 0.25)',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    marginBottom: Spacing.four,
  },
  pdfButtonText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
    marginRight: 6,
  },
  sectionCount: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
  },
  questionCard: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  questionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    paddingBottom: Spacing.two,
    marginBottom: Spacing.two,
  },
  questionNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  verdictBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  verdictText: {
    fontSize: 9.5,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  objectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  objectButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.primary,
  },
  questionCardBody: {
    gap: 8,
  },
  feedbackLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  feedbackText: {
    fontSize: 12.5,
    color: Colors.dark.text,
    lineHeight: 18,
  },
  idealApproachBox: {
    backgroundColor: Colors.dark.surfaceLight,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
  },
  idealLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    marginBottom: 4,
  },
  idealText: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
    lineHeight: 16,
  },
  studentAnswerBox: {
    backgroundColor: Colors.dark.surfaceLight,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  studentAnswerText: {
    fontSize: 11.5,
    fontStyle: 'italic',
    color: Colors.dark.textSecondary,
    lineHeight: 16,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  modalContent: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 20,
    width: '100%',
    maxWidth: 340,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  modalSubtitle: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  modalBody: {
    padding: Spacing.three,
  },
  modalLabel: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: Colors.dark.surfaceLight,
    borderColor: Colors.dark.borderLight,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
    color: Colors.dark.text,
    textAlignVertical: 'top',
    height: 100,
    marginBottom: Spacing.three,
  },
  modalSubmitBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.dark.primary,
    borderRadius: 12,
    paddingVertical: 12,
  },
  disabledSubmit: {
    opacity: 0.5,
  },
  modalSubmitBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  pdfModalHeader: {
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
});
