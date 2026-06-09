import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { BarChart2, ChevronLeft, AlertCircle, CheckCircle, Clock, XCircle, ChevronDown } from 'lucide-react-native';
import { router } from 'expo-router';

type Exam = {
  id: string;
  title: string;
  subject: string;
  total_marks: number;
};

type QStat = {
  qno: string;
  maxMarks: number;
  avgAwarded: number;
  mastery: number;
  count: number;
  correct: number;
  partial: number;
  wrong: number;
};

export default function AnalyticsScreen() {
  const { user } = useAuth();
  const [loadingExams, setLoadingExams] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [stats, setStats] = useState<QStat[]>([]);
  const [selectorVisible, setSelectorVisible] = useState(false);

  const fetchExams = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('exams')
        .select('id, title, subject, total_marks')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const examList = data ?? [];
      setExams(examList);
      if (examList.length > 0 && !selectedExamId) {
        setSelectedExamId(examList[0].id);
      }
    } catch (err) {
      console.error('Error fetching exams for analytics:', err);
    } finally {
      setLoadingExams(false);
      setRefreshing(false);
    }
  };

  const fetchStats = async (examId: string) => {
    if (!examId) return;
    setLoadingStats(true);
    try {
      // 1. Fetch script IDs for the selected exam
      const { data: scripts, error: scriptsErr } = await supabase
        .from('answer_scripts')
        .select('id')
        .eq('exam_id', examId);

      if (scriptsErr) throw scriptsErr;

      if (!scripts || scripts.length === 0) {
        setStats([]);
        return;
      }

      // 2. Fetch all questions for those scripts
      const { data: questions, error: questionsErr } = await supabase
        .from('script_questions')
        .select('qno, max_marks, awarded_marks, verdict')
        .in('script_id', scripts.map((s) => s.id));

      if (questionsErr) throw questionsErr;

      // 3. Aggregate stats per question
      const map = new Map<string, { qno: string; max: number; total: number; count: number; correct: number; partial: number; wrong: number }>();
      for (const q of questions ?? []) {
        const key = q.qno;
        const existing = map.get(key) ?? { qno: key, max: q.max_marks, total: 0, count: 0, correct: 0, partial: 0, wrong: 0 };
        existing.total += q.awarded_marks;
        existing.count += 1;
        if (q.verdict === 'correct') existing.correct++;
        else if (q.verdict === 'partial') existing.partial++;
        else existing.wrong++;
        map.set(key, existing);
      }

      const aggregated: QStat[] = Array.from(map.values())
        .sort((a, b) => a.qno.localeCompare(b.qno, undefined, { numeric: true }))
        .map((q) => ({
          qno: q.qno,
          maxMarks: q.max,
          avgAwarded: q.count > 0 ? Math.round((q.total / q.count) * 10) / 10 : 0,
          mastery: q.count > 0 ? Math.round((q.total / (q.count * q.max)) * 100) : 0,
          count: q.count,
          correct: q.correct,
          partial: q.partial,
          wrong: q.wrong,
        }));

      setStats(aggregated);
    } catch (err) {
      console.error('Error fetching exam stats:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    fetchExams();
  }, [user]);

  useEffect(() => {
    if (selectedExamId) {
      fetchStats(selectedExamId);
    }
  }, [selectedExamId]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchExams();
    if (selectedExamId) {
      fetchStats(selectedExamId);
    }
  };

  const getMasteryColor = (mastery: number) => {
    if (mastery >= 75) return Colors.dark.success;
    if (mastery >= 60) return Colors.dark.warning;
    return Colors.dark.error;
  };

  const avgMastery = stats.length > 0
    ? Math.round(stats.reduce((s, q) => s + q.mastery, 0) / stats.length)
    : 0;

  if (loadingExams && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  const selectedExam = exams.find((e) => e.id === selectedExamId);

  return (
    <View style={styles.container}>
      {/* Sub Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.dark.surface }}>
        <View style={styles.subHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={16} color={Colors.dark.textSecondary} style={{ marginRight: 4 }} />
            <Text style={styles.backBtnText}>Dashboard</Text>
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle}>Class Analytics</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />
        }
      >
        {/* Dropdown Selector */}
        {exams.length > 0 ? (
          <View style={styles.selectorCard}>
            <Text style={styles.selectorLabel}>Select Exam Component</Text>
            <TouchableOpacity 
              style={styles.dropdownTrigger}
              onPress={() => setSelectorVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                {selectedExam ? `${selectedExam.title} (${selectedExam.subject})` : 'Select an exam...'}
              </Text>
              <ChevronDown size={16} color={Colors.dark.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <BarChart2 size={38} color={Colors.dark.textSecondary} />
            <Text style={styles.emptyTitle}>No exams found</Text>
            <Text style={styles.emptySubtitle}>You must evaluate exams to view analytics.</Text>
          </View>
        )}

        {selectedExamId && (
          loadingStats ? (
            <ActivityIndicator size="large" color={Colors.dark.primary} style={{ marginTop: 40 }} />
          ) : stats.length > 0 ? (
            <View>
              {/* Summary Cards */}
              <View style={styles.summaryGrid}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Questions</Text>
                  <Text style={[styles.summaryValue, { color: Colors.dark.primary }]}>{stats.length}</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Avg Mastery</Text>
                  <Text style={[styles.summaryValue, { color: getMasteryColor(avgMastery) }]}>{avgMastery}%</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Scripts Count</Text>
                  <Text style={[styles.summaryValue, { color: Colors.dark.text }]}>{stats[0]?.count ?? 0}</Text>
                </View>
              </View>

              {/* Mastery Breakdown */}
              <Text style={styles.sectionTitle}>Question-wise Mastery</Text>
              <View style={styles.questionsContainer}>
                {stats.map((q) => {
                  const masteryColor = getMasteryColor(q.mastery);
                  return (
                    <View key={q.qno} style={styles.qCard}>
                      {/* Q Number & Average */}
                      <View style={styles.qCardHeader}>
                        <Text style={styles.qNumText}>Question {q.qno}</Text>
                        <Text style={styles.qAvgText}>
                          Avg: {q.avgAwarded}<Text style={{ fontSize: 9, color: Colors.dark.textSecondary }}>/{q.maxMarks}</Text>
                        </Text>
                      </View>

                      {/* Mastery Bar */}
                      <View style={styles.progressRow}>
                        <View style={styles.progressBarBg}>
                          <View style={[styles.progressBarFill, { width: `${q.mastery}%`, backgroundColor: masteryColor }]} />
                        </View>
                        <Text style={[styles.masteryPercentage, { color: masteryColor }]}>{q.mastery}%</Text>
                      </View>

                      {/* Verdict counters */}
                      <View style={styles.verdictRow}>
                        <View style={styles.verdictItem}>
                          <CheckCircle size={10} color={Colors.dark.success} style={{ marginRight: 4 }} />
                          <Text style={styles.verdictText}>Correct: <Text style={{ fontWeight: '700', color: Colors.dark.text }}>{q.correct}</Text></Text>
                        </View>
                        <View style={styles.verdictItem}>
                          <Clock size={10} color={Colors.dark.warning} style={{ marginRight: 4 }} />
                          <Text style={styles.verdictText}>Partial: <Text style={{ fontWeight: '700', color: Colors.dark.text }}>{q.partial}</Text></Text>
                        </View>
                        <View style={styles.verdictItem}>
                          <XCircle size={10} color={Colors.dark.error} style={{ marginRight: 4 }} />
                          <Text style={styles.verdictText}>Incorrect: <Text style={{ fontWeight: '700', color: Colors.dark.text }}>{q.wrong}</Text></Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <AlertCircle size={28} color={Colors.dark.textSecondary} />
              <Text style={styles.emptyTitle}>No evaluations completed</Text>
              <Text style={styles.emptySubtitle}>Evaluate answer scripts for this exam to unlock Class Analytics.</Text>
            </View>
          )
        )}
      </ScrollView>

      {/* Custom Selector Modal */}
      <Modal
        visible={selectorVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectorVisible(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectorVisible(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Exam Component</Text>
              <TouchableOpacity onPress={() => setSelectorVisible(false)}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.selectorList}>
              {exams.map((ex) => {
                const isSelected = ex.id === selectedExamId;
                return (
                  <TouchableOpacity
                    key={ex.id}
                    style={[styles.selectorItem, isSelected && styles.selectedSelectorItem]}
                    onPress={() => {
                      setSelectedExamId(ex.id);
                      setSelectorVisible(false);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.selectorItemText, isSelected && styles.selectedSelectorItemText]}>
                        {ex.title}
                      </Text>
                      <Text style={styles.selectorItemSubtext}>{ex.subject}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
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
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  scrollContent: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
  },
  selectorCard: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    marginBottom: Spacing.four,
  },
  selectorLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: Colors.dark.textSecondary,
    marginBottom: 6,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.dark.surfaceLight,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownTriggerText: {
    fontSize: 13,
    color: Colors.dark.text,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  summaryLabel: {
    fontSize: 10,
    color: Colors.dark.textSecondary,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 18,
    fontFamily: Fonts.mono,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: Spacing.three,
    marginTop: Spacing.two,
  },
  questionsContainer: {
    gap: Spacing.three,
  },
  qCard: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
  },
  qCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  qNumText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  qAvgText: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    color: Colors.dark.text,
    fontWeight: '600',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  progressBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: Colors.dark.surfaceLight,
    borderRadius: 4,
    marginRight: 10,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  masteryPercentage: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    minWidth: 36,
    textAlign: 'right',
  },
  verdictRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    paddingTop: 10,
  },
  verdictItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  verdictText: {
    fontSize: 9.5,
    color: Colors.dark.textSecondary,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark.text,
    marginTop: 6,
  },
  emptySubtitle: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  modalContent: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    width: '100%',
    maxHeight: '70%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  closeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.primary,
  },
  selectorList: {
    padding: 8,
  },
  selectorItem: {
    padding: 14,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: Colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selectedSelectorItem: {
    borderColor: Colors.dark.primary,
    backgroundColor: 'rgba(235, 94, 40, 0.08)',
  },
  selectorItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  selectedSelectorItemText: {
    color: Colors.dark.primary,
  },
  selectorItemSubtext: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
});
