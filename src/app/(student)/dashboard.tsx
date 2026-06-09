import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { BookOpen, Bell, Calendar, Award, RefreshCw, AlertCircle, Megaphone, CheckCircle, Clock, GraduationCap, TrendingUp, ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';

type ActiveSemester = {
  id: string;
  name: string;
  registration_open: boolean;
};

type Course = {
  code: string;
  title: string;
  credits: number;
};

type Teacher = {
  full_name: string;
};

type Offering = {
  course: Course;
  teacher: Teacher;
};

type Enrollment = {
  id: string;
  status: string;
  offering_id: string;
  offering: Offering;
};

type Announcement = {
  id: string;
  title: string;
  content: string;
  created_at: string;
};

type Script = {
  id: string;
  status: string;
  total_awarded: number;
  exam: {
    title: string;
    subject: string;
    total_marks: number;
  };
};

type Mark = {
  enrollment_id: string;
  component: string;
  marks_obtained: number;
  max_marks: number;
};

import GlobalHeader from '../../components/GlobalHeader';

// ... rest of imports & type definitions ...
export default function StudentDashboard() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [semester, setSemester] = useState<ActiveSemester | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);

  const fetchData = async () => {
    if (!user) return;

    try {
      const [semRes, enrollRes, announcRes, scriptRes] = await Promise.all([
        supabase.from('semesters')
          .select('id, name, registration_open')
          .eq('is_active', true)
          .maybeSingle(),

        supabase.from('enrollments')
          .select('id, status, offering_id, offering:course_offerings!enrollments_offering_id_fkey(course:courses(code, title, credits), teacher:profiles!course_offerings_teacher_id_fkey(full_name))')
          .eq('student_id', user.id)
          .not('status', 'eq', 'dropped'),

        supabase.from('announcements')
          .select('id, title, content, created_at')
          .in('target', ['all', 'students'])
          .order('created_at', { ascending: false })
          .limit(3),

        supabase.from('answer_scripts')
          .select('id, status, total_awarded, exam:exams!exam_id(title, subject, total_marks)')
          .eq('student_id', user.id)
          .eq('status', 'evaluated')
          .order('evaluated_at', { ascending: false })
          .limit(5),
      ]);

      setSemester((semRes.data as ActiveSemester) ?? null);
      
      const rawEnrollments = (enrollRes.data as unknown as Enrollment[]) ?? [];
      setEnrollments(rawEnrollments);
      setAnnouncements((announcRes.data as Announcement[]) ?? []);
      setScripts((scriptRes.data as unknown as Script[]) ?? []);

      if (rawEnrollments.length > 0) {
        const ids = rawEnrollments.map((e) => e.id);
        const { data: marksData } = await supabase.from('student_marks')
          .select('enrollment_id, component, marks_obtained, max_marks')
          .in('enrollment_id', ids);
        setMarks((marksData as Mark[]) ?? []);
      } else {
        setMarks([]);
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const firstName = profile?.full_name?.split(' ')[0] ?? 'Student';
  
  // Calculate average score percentage
  const evaluatedScripts = scripts.filter((s) => s.total_awarded != null && s.exam);
  const overallPct = evaluatedScripts.length
    ? Math.round(evaluatedScripts.reduce((sum, s) => sum + (s.total_awarded / s.exam.total_marks) * 100, 0) / evaluatedScripts.length)
    : null;

  // Group marks by enrollment ID
  const marksMap = marks.reduce<Record<string, Mark[]>>((acc, m) => {
    if (!acc[m.enrollment_id]) acc[m.enrollment_id] = [];
    acc[m.enrollment_id].push(m);
    return acc;
  }, {});

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.dark.background }}>
      <GlobalHeader role="student" title="Dashboard" />
      <ScrollView 
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />
        }
      >
      {/* Welcome Message */}
      <View style={styles.header}>
        <Text style={styles.greetingText}>Hi, {firstName} 👋</Text>
        {profile?.roll_number && (
          <Text style={styles.subText}>
            {profile.roll_number}{profile.branch ? ` · ${profile.branch}` : ''}{profile.year ? ` · Year ${profile.year}` : ''}
          </Text>
        )}
      </View>

      {/* Active Semester Banner */}
      {semester && (
        <View style={styles.banner}>
          <View style={styles.bannerIcon}>
            <Calendar size={16} color={Colors.dark.primary} />
          </View>
          <View style={styles.bannerBody}>
            <Text style={styles.bannerTitle}>{semester.name}</Text>
            <Text style={styles.bannerSubtitle}>Active Semester</Text>
          </View>
          {semester.registration_open ? (
            <View style={[styles.badge, styles.successBadge]}>
              <CheckCircle size={10} color={Colors.dark.success} style={{ marginRight: 4 }} />
              <Text style={styles.successBadgeText}>Open</Text>
            </View>
          ) : (
            <View style={[styles.badge, styles.mutedBadge]}>
              <Clock size={10} color={Colors.dark.textSecondary} style={{ marginRight: 4 }} />
              <Text style={styles.mutedBadgeText}>Closed</Text>
            </View>
          )}
        </View>
      )}

      {/* AI Average Panel */}
      <View style={styles.metricCard}>
        <View style={styles.metricRow}>
          <View>
            <Text style={styles.metricLabel}>Overall AI Average</Text>
            <Text style={styles.metricSubLabel}>rubric-aligned script scoring</Text>
          </View>
          <Award size={24} color={Colors.dark.primary} />
        </View>
        <View style={styles.metricValueContainer}>
          {overallPct !== null ? (
            <>
              <Text style={styles.metricValue}>{overallPct}%</Text>
              <Text style={styles.metricHint}>calculated from {evaluatedScripts.length} graded scripts</Text>
            </>
          ) : (
            <Text style={styles.metricNoValue}>No evaluated scripts available yet</Text>
          )}
        </View>
      </View>

      {/* Quick Links */}
      <View style={styles.quickLinksContainer}>
        <TouchableOpacity 
          style={styles.quickLinkCard}
          onPress={() => router.push('/(student)/grades')}
        >
          <View style={styles.quickLinkIconWrapper}>
            <GraduationCap size={20} color={Colors.dark.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickLinkTitle}>My Grades</Text>
            <Text style={styles.quickLinkSub}>View published results</Text>
          </View>
          <ChevronRight size={16} color={Colors.dark.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.quickLinkCard}
          onPress={() => router.push('/(student)/progress')}
        >
          <View style={styles.quickLinkIconWrapper}>
            <TrendingUp size={20} color={Colors.dark.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickLinkTitle}>Academic Progress</Text>
            <Text style={styles.quickLinkSub}>Track degree completion</Text>
          </View>
          <ChevronRight size={16} color={Colors.dark.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Course List */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <BookOpen size={16} color={Colors.dark.primary} style={{ marginRight: 8 }} />
          <Text style={styles.cardTitle}>Enrolled Courses</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{enrollments.length}</Text>
          </View>
        </View>
        
        {enrollments.length > 0 ? (
          <View style={styles.coursesList}>
            {enrollments.map((enr, index) => {
              const course = enr.offering?.course;
              const teacher = enr.offering?.teacher;
              const courseMarks = marksMap[enr.id] ?? [];

              const statusColor = enr.status === 'approved' ? Colors.dark.success 
                : enr.status === 'pending' ? Colors.dark.warning
                : Colors.dark.textSecondary;

              return (
                <View key={enr.id} style={[styles.courseRow, index > 0 && styles.borderTop]}>
                  <View style={styles.courseHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                        <Text style={styles.courseCode}>{course?.code ?? 'N/A'}</Text>
                        <Text style={styles.courseTitle} numberOfLines={1}>{course?.title ?? 'Unknown Course'}</Text>
                      </View>
                      <Text style={styles.courseSubtext}>
                        {teacher?.full_name ?? 'No instructor'} {course?.credits ? `· ${course.credits} Credits` : ''}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor + '15' }]}>
                      <Text style={[styles.statusBadgeText, { color: statusColor }]}>{enr.status}</Text>
                    </View>
                  </View>

                  {/* Marks Component Row */}
                  {courseMarks.length > 0 ? (
                    <View style={styles.marksRow}>
                      {courseMarks.map((m) => (
                        <View key={m.component} style={styles.markItem}>
                          <Text style={styles.markComponent}>{m.component}</Text>
                          <Text style={styles.markValue}>{m.marks_obtained}/{m.max_marks}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.noMarksText}>No marks uploaded yet</Text>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <AlertCircle size={20} color={Colors.dark.textSecondary} />
            <Text style={styles.emptyText}>You are not enrolled in any courses</Text>
          </View>
        )}
      </View>

      {/* Announcements */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Megaphone size={16} color={Colors.dark.primary} style={{ marginRight: 8 }} />
          <Text style={styles.cardTitle}>Latest Announcements</Text>
        </View>

        {announcements.length > 0 ? (
          <View style={styles.announcementsList}>
            {announcements.map((ann, index) => {
              const formattedDate = new Date(ann.created_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              });
              
              return (
                <View key={ann.id} style={[styles.announcementRow, index > 0 && styles.borderTop]}>
                  <View style={styles.announcementHeader}>
                    <Text style={styles.announcementTitle}>{ann.title}</Text>
                    <Text style={styles.announcementDate}>{formattedDate}</Text>
                  </View>
                  <Text style={styles.announcementBody}>{ann.content}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <Megaphone size={20} color={Colors.dark.textSecondary} />
            <Text style={styles.emptyText}>No recent announcements</Text>
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
    paddingBottom: Spacing.five,
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
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    marginBottom: Spacing.three,
  },
  bannerIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(235, 94, 40, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.two,
  },
  bannerBody: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  bannerSubtitle: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  successBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  successBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.dark.success,
  },
  mutedBadge: {
    backgroundColor: 'rgba(204, 197, 185, 0.1)',
  },
  mutedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  metricCard: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  metricLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  metricSubLabel: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  metricValueContainer: {
    marginTop: Spacing.one,
  },
  metricValue: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.dark.primary,
  },
  metricHint: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: 4,
  },
  metricNoValue: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    fontStyle: 'italic',
  },
  quickLinksContainer: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginBottom: Spacing.three,
  },
  quickLinkCard: {
    flex: 1,
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickLinkIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(235, 94, 40, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.two,
  },
  quickLinkTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  quickLinkSub: {
    fontSize: 10,
    color: Colors.dark.textSecondary,
    marginTop: 2,
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
  coursesList: {
    marginTop: Spacing.one,
  },
  courseRow: {
    paddingVertical: 12,
  },
  courseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  courseCode: {
    fontSize: 10,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.dark.primary,
    backgroundColor: 'rgba(235, 94, 40, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
  },
  courseTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.text,
    flexShrink: 1,
  },
  courseSubtext: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  marksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
  markItem: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.surfaceLight,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: 'center',
  },
  markComponent: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    textTransform: 'uppercase',
    marginRight: 4,
  },
  markValue: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  noMarksText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    fontStyle: 'italic',
    marginTop: Spacing.one,
  },
  announcementsList: {
    marginTop: Spacing.one,
  },
  announcementRow: {
    paddingVertical: 12,
  },
  announcementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.one,
  },
  announcementTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.text,
    flex: 1,
    marginRight: Spacing.two,
  },
  announcementDate: {
    fontSize: 10,
    color: Colors.dark.textSecondary,
  },
  announcementBody: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.four,
    gap: 8,
  },
  emptyText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontStyle: 'italic',
  },
});
