import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, TextInput, Alert } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { Scale, CheckCircle, Clock, ArrowLeft, User, FileText, Check, AlertTriangle } from 'lucide-react-native';

type Objection = {
  id: string;
  text: string;
  qno: string | null;
  status: 'sent' | 'review' | 'updated';
  raised_at: string;
  updated_marks: number | null;
  student: {
    full_name: string;
    roll_number: string;
  } | null;
  script: {
    id: string;
    total_awarded: number | null;
    exam: {
      id: string;
      title: string;
      subject: string;
      total_marks: number;
    } | null;
  } | null;
};

type QuestionDetails = {
  id: string;
  qno: string;
  max_marks: number;
  awarded_marks: number;
  verdict: 'correct' | 'partial' | 'wrong';
  ai_feedback: string;
  correct_approach: string | null;
  student_answer: string | null;
};

export default function DisputesScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentView, setCurrentView] = useState<'list' | 'detail'>('list');

  const [objections, setObjections] = useState<Objection[]>([]);
  const [selectedObjection, setSelectedObjection] = useState<Objection | null>(null);
  const [questionDetail, setQuestionDetail] = useState<QuestionDetails | null>(null);

  // Form states
  const [resolveMarks, setResolveMarks] = useState('');
  const [resolving, setResolving] = useState(false);

  const fetchObjections = async () => {
    if (!user) return;
    try {
      // Get all exams created by this teacher
      const { data: exams } = await supabase
        .from('exams')
        .select('id')
        .eq('created_by', user.id);

      const examIds = exams?.map((e) => e.id) ?? [];
      if (examIds.length === 0) {
        setObjections([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Get all answer script IDs for those exams
      const { data: scripts } = await supabase
        .from('answer_scripts')
        .select('id')
        .in('exam_id', examIds);

      const scriptIds = scripts?.map((s) => s.id) ?? [];
      if (scriptIds.length === 0) {
        setObjections([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Fetch objections for those scripts
      const { data, error } = await supabase
        .from('paper_objections')
        .select(`
          id,
          text,
          qno,
          status,
          raised_at,
          updated_marks,
          student:profiles!student_id(full_name, roll_number),
          script:answer_scripts!script_id(
            id,
            total_awarded,
            exam:exams!exam_id(id, title, subject, total_marks)
          )
        `)
        .in('script_id', scriptIds)
        .order('raised_at', { ascending: false });

      if (error) throw error;
      setObjections((data as unknown as Objection[]) ?? []);
    } catch (err) {
      console.error('Error fetching teacher objections:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchQuestionDetails = async (scriptId: string, qno: string) => {
    try {
      const { data, error } = await supabase
        .from('script_questions')
        .select('id, qno, max_marks, awarded_marks, verdict, ai_feedback, correct_approach, student_answer')
        .eq('script_id', scriptId)
        .eq('qno', qno)
        .maybeSingle();

      if (error) throw error;
      setQuestionDetail(data as QuestionDetails);
      if (data) {
        setResolveMarks(String(data.awarded_marks));
      }
    } catch (err) {
      console.error('Error fetching question details:', err);
    }
  };

  useEffect(() => {
    fetchObjections();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    if (currentView === 'list') {
      fetchObjections();
    } else if (currentView === 'detail' && selectedObjection) {
      fetchQuestionDetails(selectedObjection.script?.id ?? '', selectedObjection.qno ?? '');
    }
  };

  const handleSelectObjection = async (objection: Objection) => {
    setSelectedObjection(objection);
    setCurrentView('detail');
    setLoading(true);
    await fetchQuestionDetails(objection.script?.id ?? '', objection.qno ?? '');
    setLoading(false);
  };

  const handleBackToList = () => {
    setSelectedObjection(null);
    setQuestionDetail(null);
    setResolveMarks('');
    setCurrentView('list');
    fetchObjections();
  };

  const handleResolveObjection = async () => {
    if (!selectedObjection || !questionDetail) return;
    const score = parseFloat(resolveMarks);

    if (isNaN(score) || score < 0 || score > questionDetail.max_marks) {
      Alert.alert('Invalid Marks', `Please input a score between 0 and ${questionDetail.max_marks}`);
      return;
    }

    setResolving(true);
    try {
      const scriptId = selectedObjection.script?.id ?? '';
      const qno = selectedObjection.qno ?? '';

      // 1. Update script question marks
      const verdict = score === questionDetail.max_marks ? 'correct' : score > 0 ? 'partial' : 'wrong';
      const { error: qErr } = await supabase
        .from('script_questions')
        .update({ awarded_marks: score, verdict })
        .eq('script_id', scriptId)
        .eq('qno', qno);

      if (qErr) throw qErr;

      // 2. Fetch all questions to sum total marks
      const { data: qList } = await supabase
        .from('script_questions')
        .select('awarded_marks')
        .eq('script_id', scriptId);

      const newTotal = (qList ?? []).reduce((sum, q) => sum + (q.awarded_marks ?? 0), 0);

      // 3. Update script total
      const { error: sErr } = await supabase
        .from('answer_scripts')
        .update({ total_awarded: newTotal })
        .eq('id', scriptId);

      if (sErr) throw sErr;

      // 4. Update objection status
      const { error: oErr } = await supabase
        .from('paper_objections')
        .update({ status: 'updated', updated_marks: score })
        .eq('id', selectedObjection.id);

      if (oErr) throw oErr;

      Alert.alert('Objection Resolved', `Marks successfully updated to ${score}/${questionDetail.max_marks}`);
      handleBackToList();
    } catch (err: any) {
      Alert.alert('Resolution Failed', err.message || 'Error occurred.');
    } finally {
      setResolving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    if (status === 'updated') {
      return (
        <View style={[styles.badge, styles.successBadge]}>
          <CheckCircle size={10} color={Colors.dark.success} style={{ marginRight: 4 }} />
          <Text style={styles.successBadgeText}>Resolved</Text>
        </View>
      );
    }
    if (status === 'review') {
      return (
        <View style={[styles.badge, styles.reviewBadge]}>
          <Text style={styles.reviewBadgeText}>Under Review</Text>
        </View>
      );
    }
    return (
      <View style={[styles.badge, styles.submittedBadge]}>
        <Clock size={10} color={Colors.dark.warning} style={{ marginRight: 4 }} />
        <Text style={styles.submittedBadgeText}>Pending</Text>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header back button */}
      {currentView === 'detail' && (
        <View style={styles.subHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={handleBackToList}>
            <ArrowLeft size={16} color={Colors.dark.textSecondary} style={{ marginRight: 6 }} />
            <Text style={styles.backBtnText}>Disputes</Text>
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle} numberOfLines={1}>
            Resolve Objection: Q{selectedObjection?.qno}
          </Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />
        }
      >
        {currentView === 'list' ? (
          /* Objection List View */
          <View>
            <View style={{ marginBottom: Spacing.four }}>
              <Text style={styles.title}>Objections center</Text>
              <Text style={styles.subtitle}>Review grading corrections and student re-evaluation requests</Text>
            </View>

            {objections.length > 0 ? (
              <View style={styles.listContainer}>
                {objections.map((o) => {
                  const studentName = o.student?.full_name ?? 'Student';
                  const dateStr = new Date(o.raised_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  });

                  return (
                    <TouchableOpacity
                      key={o.id}
                      style={styles.card}
                      onPress={() => handleSelectObjection(o)}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={styles.cardHeaderRow}>
                          <Text style={styles.examTitle}>{o.script?.exam?.title}</Text>
                          {o.qno && (
                            <View style={styles.qnoBadge}>
                              <Text style={styles.qnoText}>Q{o.qno}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.studentSub}>
                          {studentName} • Raised {dateStr}
                        </Text>
                        <Text style={styles.objectionPreview} numberOfLines={2}>
                          "{o.text}"
                        </Text>
                      </View>
                      <View style={{ marginLeft: 12, alignItems: 'flex-end', justifyContent: 'center' }}>
                        {getStatusBadge(o.status)}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <Scale size={38} color={Colors.dark.textSecondary} />
                <Text style={styles.emptyTitle}>All clear!</Text>
                <Text style={styles.emptySubtitle}>No open student grading objections found.</Text>
              </View>
            )}
          </View>
        ) : (
          /* Objection Details Resolve View */
          selectedObjection && (
            <View style={{ gap: Spacing.three }}>
              {/* Student and Objection Card */}
              <View style={styles.detailCard}>
                <View style={styles.detailCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailExam}>{selectedObjection.script?.exam?.title}</Text>
                    <Text style={styles.detailStudent}>
                      {selectedObjection.student?.full_name} • {selectedObjection.student?.roll_number}
                    </Text>
                  </View>
                  {getStatusBadge(selectedObjection.status)}
                </View>

                <View style={styles.objectionReasonBox}>
                  <Text style={styles.sectionTitle}>STUDENT OBJECTION REASONING</Text>
                  <Text style={styles.objectionReasonText}>"{selectedObjection.text}"</Text>
                </View>
              </View>

              {/* Question Evaluation details */}
              {questionDetail ? (
                <View style={styles.detailCard}>
                  <View style={styles.questionMetaHeader}>
                    <Text style={styles.questionMetaTitle}>Question {questionDetail.qno} Breakdown</Text>
                    <Text style={styles.questionMetaScore}>
                      Current Marks: <Text style={{ color: Colors.dark.primary, fontWeight: '700' }}>{questionDetail.awarded_marks}</Text>/{questionDetail.max_marks}
                    </Text>
                  </View>

                  {/* AI Feedback */}
                  <View style={styles.feedbackSection}>
                    <Text style={styles.sectionTitle}>AI GRADING FEEDBACK</Text>
                    <Text style={styles.feedbackText}>{questionDetail.ai_feedback}</Text>
                  </View>

                  {/* Extracted Answer */}
                  {questionDetail.student_answer && (
                    <View style={styles.transcriptionSection}>
                      <Text style={[styles.sectionTitle, { color: Colors.dark.primary }]}>EXTRACTED STUDENT RESPONSE</Text>
                      <Text style={styles.transcriptionText}>{questionDetail.student_answer}</Text>
                    </View>
                  )}

                  {/* Ideal Approach */}
                  {questionDetail.correct_approach && (
                    <View style={styles.approachSection}>
                      <Text style={[styles.sectionTitle, { color: Colors.dark.success }]}>IDEAL EXPECTED APPROACH</Text>
                      <Text style={styles.approachText}>{questionDetail.correct_approach}</Text>
                    </View>
                  )}

                  {/* Resolve Action Form */}
                  {selectedObjection.status !== 'updated' ? (
                    <View style={styles.resolveForm}>
                      <Text style={styles.resolveFormTitle}>Adjust Awarded Score</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <TextInput
                          style={styles.resolveInput}
                          keyboardType="numeric"
                          value={resolveMarks}
                          onChangeText={setResolveMarks}
                          placeholder="Marks"
                          placeholderTextColor="#4a4745"
                        />
                        <Text style={styles.outOfText}>/ {questionDetail.max_marks} Marks</Text>

                        <TouchableOpacity
                          style={[styles.resolveBtn, resolving && styles.disabledBtn]}
                          onPress={handleResolveObjection}
                          disabled={resolving}
                        >
                          {resolving ? (
                            <ActivityIndicator size="small" color={Colors.dark.text} />
                          ) : (
                            <>
                              <Check size={14} color={Colors.dark.text} style={{ marginRight: 6 }} />
                              <Text style={styles.resolveBtnText}>Submit Grade</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.resolvedInfoBox}>
                      <CheckCircle size={16} color={Colors.dark.success} style={{ marginRight: 8 }} />
                      <Text style={styles.resolvedInfoText}>
                        Objection resolved. Adjusted marks: {selectedObjection.updated_marks}/{questionDetail.max_marks}
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.detailCard}>
                  <Text style={styles.feedbackText}>Question details could not be parsed for this objection.</Text>
                </View>
              )}
            </View>
          )
        )}
      </ScrollView>
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
  card: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: Spacing.three,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  examTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  qnoBadge: {
    backgroundColor: 'rgba(235, 94, 40, 0.12)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  qnoText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.dark.primary,
  },
  studentSub: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: 4,
  },
  objectionPreview: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontStyle: 'italic',
    marginTop: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  successBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  successBadgeText: {
    fontSize: 9.5,
    fontWeight: '600',
    color: Colors.dark.success,
  },
  reviewBadge: {
    backgroundColor: 'rgba(235, 94, 40, 0.12)',
  },
  reviewBadgeText: {
    fontSize: 9.5,
    fontWeight: '600',
    color: Colors.dark.primary,
  },
  submittedBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  submittedBadgeText: {
    fontSize: 9.5,
    fontWeight: '600',
    color: Colors.dark.warning,
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
  detailCard: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: Spacing.three,
    gap: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  },
  detailCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    paddingBottom: Spacing.two,
  },
  detailExam: {
    fontSize: 14.5,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  detailStudent: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  objectionReasonBox: {
    backgroundColor: Colors.dark.surfaceLight,
    borderRadius: 12,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.dark.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  objectionReasonText: {
    fontSize: 12,
    color: Colors.dark.text,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  questionMetaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    paddingBottom: Spacing.two,
  },
  questionMetaTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  questionMetaScore: {
    fontSize: 12.5,
    color: Colors.dark.textSecondary,
  },
  feedbackSection: {},
  feedbackText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  transcriptionSection: {
    backgroundColor: Colors.dark.surfaceLight,
    borderRadius: 12,
    padding: 12,
  },
  transcriptionText: {
    fontSize: 11.5,
    color: Colors.dark.text,
    lineHeight: 17,
  },
  approachSection: {
    borderLeftWidth: 2,
    borderLeftColor: Colors.dark.success,
    paddingLeft: Spacing.two,
  },
  approachText: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
    lineHeight: 17,
  },
  resolveForm: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    paddingTop: Spacing.two,
  },
  resolveFormTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  resolveInput: {
    backgroundColor: Colors.dark.surfaceLight,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 8,
    width: 60,
    textAlign: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    color: Colors.dark.text,
    fontFamily: Fonts.mono,
  },
  outOfText: {
    fontSize: 12.5,
    color: Colors.dark.textSecondary,
  },
  resolveBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  resolveBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  disabledBtn: {
    opacity: 0.5,
  },
  resolvedInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resolvedInfoText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.dark.success,
  },
});
