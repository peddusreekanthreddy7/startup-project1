import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import GlobalHeader from '../../components/GlobalHeader';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { FileText, ChevronRight, Award, Megaphone, CheckCircle, Clock, BookOpen, AlertCircle, Plus, BarChart2, BookOpenCheck, UploadCloud, FileSpreadsheet, Bot } from 'lucide-react-native';
import { router } from 'expo-router';

type Batch = {
  id: string;
  total_awarded: number | null;
  evaluated_at: string | null;
  roll_number: string | null;
  student: { full_name: string; roll_number: string } | null;
  exam: { title: string; subject: string; total_marks: number } | null;
};

type Stats = {
  totalExams: number;
  totalEvaluated: number;
  pendingObjections: number;
};

export default function TeacherDashboard() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<Stats>({ totalExams: 0, totalEvaluated: 0, pendingObjections: 0 });
  const [batches, setBatches] = useState<Batch[]>([]);

  const fetchStatsAndBatches = async () => {
    if (!user) return;

    try {
      // Get all exams created by this teacher
      const { data: exams, error: examsErr } = await supabase
        .from('exams')
        .select('id')
        .eq('created_by', user.id);

      if (examsErr) throw examsErr;

      const examIds = exams?.map((e) => e.id) ?? [];

      let totalEvaluated = 0;
      let pendingObjections = 0;

      if (examIds.length > 0) {
        // Count evaluated scripts
        const { count: evalCount, error: evalErr } = await supabase
          .from('answer_scripts')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'evaluated')
          .in('exam_id', examIds);

        if (evalErr) throw evalErr;
        totalEvaluated = evalCount ?? 0;

        // Get script IDs
        const { data: scriptIdsData, error: scriptIdsErr } = await supabase
          .from('answer_scripts')
          .select('id')
          .in('exam_id', examIds);

        if (scriptIdsErr) throw scriptIdsErr;
        const scriptIds = scriptIdsData?.map((s) => s.id) ?? [];

        if (scriptIds.length > 0) {
          // Count pending objections
          const { count: objCount, error: objErr } = await supabase
            .from('paper_objections')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'sent')
            .in('script_id', scriptIds);

          if (objErr) throw objErr;
          pendingObjections = objCount ?? 0;
        }
      }

      setStats({
        totalExams: exams?.length ?? 0,
        totalEvaluated,
        pendingObjections,
      });

      // Fetch recent evaluated batches
      if (examIds.length > 0) {
        const { data: scripts, error: scriptsErr } = await supabase
          .from('answer_scripts')
          .select(`
            id,
            total_awarded,
            evaluated_at,
            roll_number,
            student_id,
            student:profiles!answer_scripts_student_id_fkey(full_name, roll_number),
            exam:exams!exam_id(title, subject, total_marks)
          `)
          .eq('status', 'evaluated')
          .in('exam_id', examIds)
          .order('evaluated_at', { ascending: false })
          .limit(10);

        if (scriptsErr) throw scriptsErr;

        // Fetch orphans separately
        const { data: orphans, error: orphansErr } = await supabase
          .from('answer_scripts')
          .select(`
            id,
            total_awarded,
            evaluated_at,
            roll_number,
            student_id,
            exam:exams!exam_id(title, subject, total_marks)
          `)
          .eq('status', 'evaluated')
          .is('student_id', null)
          .in('exam_id', examIds)
          .order('evaluated_at', { ascending: false })
          .limit(10);

        if (orphansErr) throw orphansErr;

        const merged = [
          ...(scripts ?? []),
          ...(orphans ?? []).map((o) => ({ ...o, student: null })),
        ]
          .sort((a, b) => {
            const ta = a.evaluated_at ? new Date(a.evaluated_at).getTime() : 0;
            const tb = b.evaluated_at ? new Date(b.evaluated_at).getTime() : 0;
            return tb - ta;
          })
          .slice(0, 10);

        setBatches(merged as unknown as Batch[]);
      } else {
        setBatches([]);
      }
    } catch (err) {
      console.error('Error fetching teacher dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatsAndBatches();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchStatsAndBatches();
  };

  const namePrefix = profile?.full_name?.split(' ')[0] ?? 'Instructor';

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.dark.background }}>
      <GlobalHeader role="teacher" title="Dashboard" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />
        }
      >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1, marginRight: Spacing.two }}>
          <Text style={styles.greetingText} numberOfLines={1}>Welcome, Prof. {namePrefix} 🎓</Text>
          {profile?.department && (
            <Text style={styles.subText}>{profile.department} Department</Text>
          )}
        </View>
        <TouchableOpacity 
          style={styles.analyticsBtn}
          onPress={() => router.push('/(teacher)/analytics')}
          activeOpacity={0.7}
        >
          <BarChart2 size={15} color={Colors.dark.primary} />
          <Text style={styles.analyticsBtnText}>Analytics</Text>
        </TouchableOpacity>
      </View>

      {/* Grid Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.totalExams}</Text>
          <Text style={styles.statLabel}>Total Exams</Text>
        </View>

        <View style={[styles.statCard, styles.borderLeft]}>
          <Text style={styles.statNumber}>{stats.totalEvaluated}</Text>
          <Text style={styles.statLabel}>Evaluated</Text>
        </View>

        <View style={[styles.statCard, styles.borderLeft]}>
          <Text style={[styles.statNumber, stats.pendingObjections > 0 && { color: Colors.dark.primary }]}>
            {stats.pendingObjections}
          </Text>
          <Text style={styles.statLabel}>Open Disputes</Text>
        </View>
      </View>

      <TouchableOpacity 
        style={[styles.quickLinkCard, { backgroundColor: Colors.dark.primary, borderColor: Colors.dark.primary, marginBottom: Spacing.four }]}
        onPress={() => router.push('/(teacher)/evaluation')}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={[styles.quickLinkIconWrapper, { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]}>
            <Bot size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.quickLinkTitle, { color: '#fff', textAlign: 'left', fontSize: 16 }]}>Evaluate Scripts</Text>
            <Text style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: 11, marginTop: 2 }}>Upload and grade via AI</Text>
          </View>
          <ChevronRight size={20} color="#fff" />
        </View>
      </TouchableOpacity>

      {/* Quick Links */}
      <View style={styles.quickLinksContainer}>
        <TouchableOpacity 
          style={styles.quickLinkCard}
          onPress={() => router.push('/(teacher)/courses')}
        >
          <View style={styles.quickLinkIconWrapper}>
            <BookOpenCheck size={18} color={Colors.dark.primary} />
          </View>
          <Text style={styles.quickLinkTitle}>My Courses</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.quickLinkCard}
          onPress={() => router.push('/(teacher)/bulk')}
        >
          <View style={styles.quickLinkIconWrapper}>
            <UploadCloud size={18} color={Colors.dark.primary} />
          </View>
          <Text style={styles.quickLinkTitle}>Reports</Text>
        </TouchableOpacity>
      </View>

      {/* Recent Evaluations */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <FileText size={16} color={Colors.dark.primary} style={{ marginRight: 8 }} />
          <Text style={styles.cardTitle}>Recent Evaluations</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{batches.length} items</Text>
          </View>
        </View>

        {batches.length > 0 ? (
          <View style={styles.listContainer}>
            {batches.map((b, index) => {
              const studentName = b.student?.full_name ?? b.roll_number ?? 'Unknown';
              const dateStr = b.evaluated_at
                ? new Date(b.evaluated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
                : 'N/A';

              return (
                <TouchableOpacity
                  key={b.id}
                  style={[styles.evaluationRow, index > 0 && styles.borderTop]}
                  activeOpacity={0.7}
                  onPress={() => router.push({ pathname: '/(teacher)/scripts', params: { scriptId: b.id } })}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.studentNameRow}>
                      <Text style={styles.studentName}>{studentName}</Text>
                      {b.student?.roll_number ? (
                        <Text style={styles.studentRoll}>{b.student.roll_number}</Text>
                      ) : (
                        <Text style={styles.noAccountBadge}>No Account</Text>
                      )}
                    </View>
                    <Text style={styles.examTitle}>{b.exam?.title} • Evaluated {dateStr}</Text>
                  </View>
                  
                  <View style={styles.scoreContainer}>
                    <Text style={styles.scoreValue}>
                      {b.total_awarded}
                      <Text style={{ fontSize: 10, color: Colors.dark.textSecondary }}>/{b.exam?.total_marks}</Text>
                    </Text>
                  </View>
                  <ChevronRight size={14} color={Colors.dark.textSecondary} style={{ marginLeft: 8 }} />
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <AlertCircle size={28} color={Colors.dark.textSecondary} />
            <Text style={styles.emptyText}>No script evaluations completed yet.</Text>
          </View>
        )}
      </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.four,
  },
  analyticsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(235, 94, 40, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(235, 94, 40, 0.2)',
  },
  analyticsBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.dark.primary,
    marginLeft: 4,
  },
  greetingText: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  subText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 4,
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 18,
    marginBottom: Spacing.four,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  borderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.dark.border,
  },
  statNumber: {
    fontSize: 26,
    fontFamily: Fonts.mono,
    fontWeight: '800',
    color: Colors.dark.text,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: 4,
  },
  quickLinksContainer: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  quickLinkCard: {
    flex: 1,
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLinkIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(235, 94, 40, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  quickLinkTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.text,
    textAlign: 'center',
  },
  card: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  countBadge: {
    backgroundColor: Colors.dark.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 'auto',
  },
  countText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  listContainer: {
    marginTop: Spacing.one,
  },
  evaluationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  studentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  studentName: {
    fontSize: 13.5,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  studentRoll: {
    fontSize: 10,
    fontFamily: Fonts.mono,
    color: Colors.dark.textSecondary,
    marginLeft: 8,
  },
  noAccountBadge: {
    fontSize: 9,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    backgroundColor: Colors.dark.surfaceLight,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
    marginLeft: 8,
  },
  examTitle: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
  },
  scoreContainer: {
    backgroundColor: Colors.dark.surfaceLight,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 54,
    alignItems: 'center',
  },
  scoreValue: {
    fontSize: 12,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.five,
    gap: 8,
  },
  emptyText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontStyle: 'italic',
  },
});
