import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Dimensions, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { TrendingUp, CheckCircle, Clock, XCircle, ChevronLeft } from 'lucide-react-native';

const { width } = Dimensions.get('window');

type Script = {
  id: string;
  status: string;
  total_awarded: number;
  evaluated_at: string;
  exam: { title: string; subject: string; total_marks: number; exam_date: string } | null;
  questions: Array<{ verdict: string; awarded_marks: number; max_marks: number }>;
};

export default function StudentProgressScreen() {
  const { user } = useAuth();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProgress = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('answer_scripts')
        .select(`
          id, status, total_awarded, evaluated_at,
          exam:exams(title, subject, total_marks, exam_date),
          questions:script_questions(verdict, awarded_marks, max_marks)
        `)
        .eq('student_id', user.id)
        .eq('status', 'evaluated')
        .order('evaluated_at', { ascending: false });

      if (error) throw error;
      setScripts((data as unknown as Script[]) ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchProgress();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchProgress();
  };

  const evaluated = scripts.filter((s) => s.total_awarded != null && s.exam);

  const overallPct = evaluated.length
    ? Math.round(
        evaluated.reduce((sum, s) => sum + (s.total_awarded / s.exam!.total_marks) * 100, 0) / evaluated.length
      )
    : null;

  const bySubject = evaluated.reduce<Record<string, { total: number; max: number; count: number }>>((acc, s) => {
    const subj = s.exam!.subject;
    if (!acc[subj]) acc[subj] = { total: 0, max: 0, count: 0 };
    acc[subj].total += s.total_awarded;
    acc[subj].max += s.exam!.total_marks;
    acc[subj].count++;
    return acc;
  }, {});

  const verdictCounts = evaluated.reduce(
    (acc, s) => {
      for (const q of s.questions ?? []) {
        if (q.verdict === 'correct') acc.correct++;
        else if (q.verdict === 'partial') acc.partial++;
        else acc.wrong++;
      }
      return acc;
    },
    { correct: 0, partial: 0, wrong: 0 }
  );
  const totalQ = verdictCounts.correct + verdictCounts.partial + verdictCounts.wrong;

  const barColor = (pct: number) => pct >= 75 ? Colors.dark.success : pct >= 60 ? Colors.dark.warning : Colors.dark.error;

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.dark.surface }}>
        <View style={styles.subHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={16} color={Colors.dark.textSecondary} style={{ marginRight: 4 }} />
            <Text style={styles.backBtnText}>Dashboard</Text>
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle}>Academic Progress</Text>
        </View>
      </SafeAreaView>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />}
      >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Academic Progress</Text>
        <Text style={styles.subText}>Performance across all evaluated exams</Text>
      </View>

      {evaluated.length === 0 ? (
        <View style={styles.emptyContainer}>
          <TrendingUp size={32} color={Colors.dark.textSecondary} style={{ marginBottom: 12 }} />
          <Text style={styles.emptyText}>No data yet</Text>
          <Text style={styles.emptySubText}>Progress will appear after your scripts are evaluated</Text>
        </View>
      ) : (
        <View style={{ gap: Spacing.four }}>
          {/* Top Stats */}
          <View style={styles.row}>
            {/* Overall Avg */}
            <View style={[styles.card, { flex: 1, marginRight: 8, alignItems: 'center' }]}>
              <Text style={styles.cardLabel}>Overall Average</Text>
              <Text style={[styles.overallScore, { color: overallPct ? barColor(overallPct) : Colors.dark.text }]}>
                {overallPct ?? 0}%
              </Text>
              <Text style={styles.cardSubText}>{evaluated.length} exam{evaluated.length !== 1 ? 's' : ''}</Text>
            </View>

            {/* Verdicts */}
            <View style={[styles.card, { flex: 1, marginLeft: 8 }]}>
              <Text style={styles.cardLabel}>Answers</Text>
              {[
                { label: 'Correct', key: 'correct' as const, color: Colors.dark.success, Icon: CheckCircle },
                { label: 'Partial', key: 'partial' as const, color: Colors.dark.warning, Icon: Clock },
                { label: 'Wrong', key: 'wrong' as const, color: Colors.dark.error, Icon: XCircle },
              ].map(({ label, key, color, Icon }) => {
                const count = verdictCounts[key];
                const pct = totalQ > 0 ? Math.round((count / totalQ) * 100) : 0;
                return (
                  <View key={key} style={styles.verdictRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Icon size={12} color={color} style={{ marginRight: 6 }} />
                      <Text style={styles.verdictLabel}>{label}</Text>
                    </View>
                    <Text style={styles.verdictValue}>{count} ({pct}%)</Text>
                  </View>
                );
              })}
              <Text style={styles.cardSubText}>{totalQ} total questions</Text>
            </View>
          </View>

          {/* By Subject */}
          {Object.keys(bySubject).length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.sectionTitle}>By Subject</Text>
              </View>
              <View style={{ padding: Spacing.three, gap: Spacing.three }}>
                {Object.entries(bySubject).map(([subj, data]) => {
                  const pct = Math.round((data.total / data.max) * 100);
                  const color = barColor(pct);
                  return (
                    <View key={subj} style={styles.subjectRow}>
                      <View style={styles.subjectInfo}>
                        <Text style={styles.subjectName} numberOfLines={1}>{subj}</Text>
                        <Text style={styles.subjectCount}>{data.count} exam{data.count !== 1 ? 's' : ''}</Text>
                      </View>
                      <View style={styles.progressBarBg}>
                        <View style={[styles.progressBarFill, { width: `${pct}%`, backgroundColor: color }]} />
                      </View>
                      <Text style={[styles.subjectPct, { color }]}>{pct}%</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Exam History */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.sectionTitle}>Exam History</Text>
            </View>
            <View>
              {evaluated.map((s, i) => {
                const pct = Math.round((s.total_awarded / s.exam!.total_marks) * 100);
                const color = barColor(pct);
                const date = s.evaluated_at
                  ? new Date(s.evaluated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
                  : '—';

                return (
                  <View key={s.id} style={[styles.historyRow, i > 0 && styles.borderTop]}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text style={styles.historyTitle} numberOfLines={1}>{s.exam!.title}</Text>
                      <Text style={styles.historySubText}>{s.exam!.subject} · {date}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.historyMarks, { color }]}>{s.total_awarded}/{s.exam!.total_marks}</Text>
                      <Text style={styles.historyPct}>{pct}%</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
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
  scrollContent: { padding: Spacing.three, paddingBottom: Spacing.six },
  header: { marginBottom: Spacing.four },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.dark.text },
  subText: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 4 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six * 2, backgroundColor: Colors.dark.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.dark.border },
  emptyText: { fontSize: 14, color: Colors.dark.text, fontWeight: '600', textAlign: 'center' },
  emptySubText: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 4, textAlign: 'center' },
  row: { flexDirection: 'row' },
  card: { 
    backgroundColor: Colors.dark.surface, 
    borderRadius: 16, 
    borderWidth: 1, 
    borderColor: Colors.dark.border, 
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  cardLabel: { fontSize: 9, fontWeight: '800', color: Colors.dark.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 16, marginBottom: 8, textAlign: 'center' },
  cardSubText: { fontSize: 10, color: Colors.dark.textSecondary, marginTop: 8, marginBottom: 16, textAlign: 'center' },
  overallScore: { fontSize: 36, fontWeight: '900', fontFamily: Fonts.mono, textAlign: 'center' },
  verdictRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingHorizontal: 14, marginBottom: 8 },
  verdictLabel: { fontSize: 11, color: Colors.dark.textSecondary },
  verdictValue: { fontSize: 11, fontFamily: Fonts.mono, color: Colors.dark.text, fontWeight: '600' },
  cardHeader: { paddingHorizontal: Spacing.three, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.dark.border, backgroundColor: Colors.dark.surfaceLight },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.dark.text },
  subjectRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  subjectInfo: { width: 80, marginRight: 12 },
  subjectName: { fontSize: 12, fontWeight: '600', color: Colors.dark.text },
  subjectCount: { fontSize: 10, color: Colors.dark.textSecondary },
  progressBarBg: { flex: 1, height: 8, backgroundColor: Colors.dark.surfaceLight, borderRadius: 4, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 4 },
  subjectPct: { width: 40, textAlign: 'right', fontSize: 12, fontFamily: Fonts.mono, fontWeight: '700' },
  historyRow: { flexDirection: 'row', padding: Spacing.three, alignItems: 'center', backgroundColor: Colors.dark.surface },
  borderTop: { borderTopWidth: 1, borderTopColor: Colors.dark.border },
  historyTitle: { fontSize: 13, fontWeight: '600', color: Colors.dark.text },
  historySubText: { fontSize: 11, color: Colors.dark.textSecondary, marginTop: 2 },
  historyMarks: { fontSize: 13, fontFamily: Fonts.mono, fontWeight: '700' },
  historyPct: { fontSize: 11, color: Colors.dark.textSecondary, marginTop: 2, textAlign: 'right' }
});
