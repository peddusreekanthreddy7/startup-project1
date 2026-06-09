import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { GraduationCap, Award, ChevronLeft } from 'lucide-react-native';

type CourseEntry = {
  enrollmentId: string;
  courseCode: string;
  courseTitle: string;
  credits: number;
  courseType: string;
  semesterName: string;
  semesterYear: number;
  totalObtained: number;
  totalMax: number;
  grade: string | null;
  gradePoints: number | null;
  isPublished: boolean;
};

const gradeColor = (g: string) =>
  ['S', 'A'].includes(g) ? Colors.dark.success :
  ['B', 'C'].includes(g) ? Colors.dark.warning :
  ['D', 'E'].includes(g) ? Colors.dark.primary : Colors.dark.error;

export default function StudentGradesScreen() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<CourseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchGrades = async () => {
    if (!user) return;
    try {
      // Enrollments
      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('id, offering_id')
        .eq('student_id', user.id)
        .not('status', 'eq', 'dropped');

      if (!enrollments?.length) {
        setEntries([]);
        return;
      }

      const enrollmentIds = enrollments.map((e) => e.id);
      const offeringIds = enrollments.map((e) => e.offering_id);

      // Marks
      const { data: markRows } = await supabase
        .from('student_marks')
        .select('enrollment_id, marks_obtained, max_marks')
        .in('enrollment_id', enrollmentIds);

      // Grades
      const { data: gradeRows } = await supabase
        .from('grades')
        .select('enrollment_id, grade, grade_points, is_published')
        .in('enrollment_id', enrollmentIds);

      // Offerings
      const { data: offerings } = await supabase
        .from('course_offerings')
        .select('id, course:courses(code, title, credits, course_type), semester:semesters(name, year)')
        .in('id', offeringIds);

      const offeringMap = new Map((offerings ?? []).map((o) => [o.id, o]));
      const marksByEnrollment = new Map<string, Array<{ obtained: number; max: number }>>();
      for (const m of markRows ?? []) {
        if (!marksByEnrollment.has(m.enrollment_id)) marksByEnrollment.set(m.enrollment_id, []);
        marksByEnrollment.get(m.enrollment_id)!.push({ obtained: Number(m.marks_obtained), max: Number(m.max_marks) });
      }
      const gradeByEnrollment = new Map((gradeRows ?? []).map((g) => [g.enrollment_id, g]));

      const result: CourseEntry[] = enrollments.map((e) => {
        const offering = offeringMap.get(e.offering_id) as any;
        const grade = gradeByEnrollment.get(e.id);
        const marks = marksByEnrollment.get(e.id) ?? [];

        return {
          enrollmentId: e.id,
          courseCode: offering?.course?.code ?? '—',
          courseTitle: offering?.course?.title ?? 'Unknown',
          credits: offering?.course?.credits ?? 0,
          courseType: offering?.course?.course_type ?? 'theory',
          semesterName: offering?.semester?.name ?? 'Unknown',
          semesterYear: offering?.semester?.year ?? 0,
          totalObtained: marks.reduce((s, m) => s + m.obtained, 0),
          totalMax: marks.reduce((s, m) => s + m.max, 0),
          grade: grade?.is_published ? grade.grade : null,
          gradePoints: grade?.is_published ? grade.grade_points : null,
          isPublished: grade?.is_published ?? false,
        };
      });

      setEntries(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchGrades();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchGrades();
  };

  const bySemester = new Map<string, CourseEntry[]>();
  for (const e of entries) {
    if (!bySemester.has(e.semesterName)) bySemester.set(e.semesterName, []);
    bySemester.get(e.semesterName)!.push(e);
  }

  const semesters = [...bySemester.entries()]
    .sort((a, b) => (b[1][0]?.semesterYear ?? 0) - (a[1][0]?.semesterYear ?? 0))
    .map(([name, semEntries]) => {
      const published = semEntries.filter((e) => e.isPublished && e.gradePoints != null);
      const semCredits = published.reduce((s, e) => s + e.credits, 0);
      const semWeighted = published.reduce((s, e) => s + e.credits * (e.gradePoints ?? 0), 0);
      const spi = semCredits > 0 ? Math.round((semWeighted / semCredits) * 100) / 100 : null;
      return { name, entries: semEntries, spi };
    });

  const publishedAll = entries.filter((e) => e.isPublished && e.gradePoints != null);
  const allCredits = publishedAll.reduce((s, e) => s + e.credits, 0);
  const allWeighted = publishedAll.reduce((s, e) => s + e.credits * (e.gradePoints ?? 0), 0);
  const cpi = allCredits > 0 ? Math.round((allWeighted / allCredits) * 100) / 100 : null;

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
          <Text style={styles.subHeaderTitle}>Grades & CPI</Text>
        </View>
      </SafeAreaView>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />}
      >
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Grades & CPI</Text>
          <Text style={styles.subText}>View your semester performance</Text>
        </View>
      </View>

      {cpi != null && (
        <View style={styles.cpiCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ backgroundColor: 'rgba(235, 94, 40, 0.12)', padding: 10, borderRadius: 12 }}>
              <GraduationCap size={22} color={Colors.dark.primary} />
            </View>
            <View>
              <Text style={styles.cpiLabel}>CUMULATIVE CPI</Text>
              <Text style={styles.cpiSubtext}>Based on all published courses</Text>
            </View>
          </View>
          <Text style={[styles.cpiValue, { color: cpi >= 7 ? Colors.dark.success : cpi >= 5 ? Colors.dark.warning : Colors.dark.error }]}>
            {cpi.toFixed(2)}
          </Text>
        </View>
      )}

      {entries.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Award size={32} color={Colors.dark.textSecondary} style={{ marginBottom: 12 }} />
          <Text style={styles.emptyText}>No enrolled courses</Text>
        </View>
      ) : (
        <View style={{ gap: Spacing.four }}>
          {semesters.map((sem) => (
            <View key={sem.name} style={styles.semCard}>
              <View style={styles.semHeader}>
                <View>
                  <Text style={styles.semTitle}>{sem.name}</Text>
                  <Text style={styles.semSubText}>
                    {sem.entries.reduce((s, e) => s + e.credits, 0)} credits · {sem.entries.length} courses
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.spiLabel}>SPI</Text>
                  <Text style={[styles.spiValue, { color: sem.spi ? (sem.spi >= 7 ? Colors.dark.success : sem.spi >= 5 ? Colors.dark.warning : Colors.dark.error) : Colors.dark.textSecondary }]}>
                    {sem.spi ? sem.spi.toFixed(2) : '—'}
                  </Text>
                </View>
              </View>

              <View style={styles.courseList}>
                {sem.entries.map((e, i) => (
                  <View key={e.enrollmentId} style={[styles.courseRow, i > 0 && styles.borderTop]}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                        <Text style={styles.courseCode}>{e.courseCode}</Text>
                        <Text style={styles.courseTitle} numberOfLines={1}>{e.courseTitle}</Text>
                      </View>
                      <Text style={styles.courseSubText}>
                        {e.credits} Credits · {e.courseType} · Total: {e.totalObtained}/{e.totalMax}
                      </Text>
                    </View>
                    <View style={{ justifyContent: 'center', alignItems: 'center' }}>
                      {e.isPublished && e.grade ? (
                        <View style={[styles.gradeBadge, { backgroundColor: gradeColor(e.grade) + '20' }]}>
                          <Text style={[styles.gradeText, { color: gradeColor(e.grade) }]}>{e.grade}</Text>
                        </View>
                      ) : (
                        <View style={styles.pendingBadge}>
                          <Text style={styles.pendingText}>Pending</Text>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))}
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.four },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.dark.text },
  subText: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 4 },
  cpiCard: {
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.four,
  },
  cpiLabel: { fontSize: 9, fontWeight: '800', color: Colors.dark.textSecondary, letterSpacing: 1, textTransform: 'uppercase' },
  cpiSubtext: { fontSize: 10, color: Colors.dark.textSecondary, marginTop: 2 },
  cpiValue: { fontSize: 26, fontWeight: '900', fontFamily: Fonts.mono },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six * 2, backgroundColor: Colors.dark.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.dark.border },
  emptyText: { fontSize: 14, color: Colors.dark.textSecondary, fontWeight: '600' },
  semCard: { backgroundColor: Colors.dark.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.dark.border, overflow: 'hidden', marginBottom: Spacing.four },
  semHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.dark.surfaceLight, padding: Spacing.three, borderBottomWidth: 1, borderBottomColor: Colors.dark.border },
  semTitle: { fontSize: 14, fontWeight: '700', color: Colors.dark.primary },
  semSubText: { fontSize: 11, color: Colors.dark.textSecondary, marginTop: 2 },
  spiLabel: { fontSize: 9, fontWeight: '700', color: Colors.dark.textSecondary, marginBottom: 2, textAlign: 'right' },
  spiValue: { fontSize: 16, fontWeight: '800', fontFamily: Fonts.mono, textAlign: 'right' },
  courseList: { padding: Spacing.three },
  courseRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  borderTop: { borderTopWidth: 1, borderTopColor: Colors.dark.border },
  courseCode: { fontSize: 11, fontFamily: Fonts.mono, fontWeight: '700', color: Colors.dark.primary, marginRight: 8 },
  courseTitle: { fontSize: 14, fontWeight: '600', color: Colors.dark.text, flexShrink: 1 },
  courseSubText: { fontSize: 11, color: Colors.dark.textSecondary },
  gradeBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  gradeText: { fontSize: 14, fontWeight: '800', fontFamily: Fonts.mono },
  pendingBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(245, 158, 11, 0.1)' },
  pendingText: { fontSize: 10, fontWeight: '600', color: Colors.dark.warning }
});
