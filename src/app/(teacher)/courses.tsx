import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import GlobalHeader from '../../components/GlobalHeader';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { BookOpen, User } from 'lucide-react-native';

type TeacherCourse = {
  id: string;
  course: { code: string; title: string; credits: number; course_type: string };
  semester: { name: string; is_active: boolean };
  enrolled: number;
};

type StudentRow = {
  id: string; status: string;
  student: { full_name: string; roll_number: string | null } | null;
  marks: Array<{ component: string; marks_obtained: number; max_marks: number }>;
  grade: Array<{ grade: string; grade_points: number; is_published: boolean }>;
};

const componentsByType: Record<string, string[]> = {
  theory: ["internal","mid","end"],
  lab: ["continuous","end"],
  project: ["guide","midterm_review","viva"],
};

const gradeColor = (g: string) =>
  ["S","A"].includes(g) ? "#10b981" : ["B","C"].includes(g) ? "#f59e0b" :
  ["D","E"].includes(g) ? "#EB5E28" : "#ef4444";

function StudentTable({ offeringId, courseType }: { offeringId: string; courseType: string }) {
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStudents() {
      try {
        const { data } = await supabase
          .from("enrollments")
          .select(`
            id, status,
            student:profiles!enrollments_student_id_fkey(full_name, roll_number),
            marks:student_marks(component, marks_obtained, max_marks),
            grade:grades(grade, grade_points, is_published)
          `)
          .eq("offering_id", offeringId)
          .not("status", "eq", "dropped");
          
        setRows((data ?? []) as unknown as StudentRow[]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadStudents();
  }, [offeringId]);

  if (loading) {
    return (
      <View style={{ padding: Spacing.three, alignItems: 'center' }}>
        <ActivityIndicator size="small" color={Colors.dark.primary} />
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={{ padding: Spacing.three, alignItems: 'center' }}>
        <Text style={{ fontSize: 12, color: Colors.dark.textSecondary }}>No students enrolled yet</Text>
      </View>
    );
  }

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: Colors.dark.border, backgroundColor: Colors.dark.surfaceLight }}>
      {rows.map((row, i) => {
        const marks = row.marks ?? [];
        const grade = row.grade?.[0];
        const total = marks.reduce((s, m) => s + m.marks_obtained, 0);
        const statusColor = row.status === "approved" ? Colors.dark.success : row.status === "registered" ? Colors.dark.warning : Colors.dark.textSecondary;
        
        return (
          <View key={row.id} style={{ 
            padding: Spacing.three, 
            borderBottomWidth: i < rows.length - 1 ? 1 : 0, 
            borderBottomColor: Colors.dark.border 
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <View style={{ backgroundColor: 'rgba(235, 94, 40, 0.1)', padding: 6, borderRadius: 20, marginRight: 8 }}>
                  <User size={12} color={Colors.dark.primary} />
                </View>
                <View>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.dark.text }}>{row.student?.full_name ?? "—"}</Text>
                  <Text style={{ fontSize: 10, fontFamily: Fonts.mono, color: Colors.dark.textSecondary }}>{row.student?.roll_number ?? "—"}</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: statusColor, textTransform: 'capitalize' }}>
                  {row.status}
                </Text>
                {grade?.is_published && grade.grade ? (
                  <View style={{ backgroundColor: gradeColor(grade.grade) + "18", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: gradeColor(grade.grade) }}>Grade: {grade.grade}</Text>
                  </View>
                ) : (
                  <Text style={{ fontSize: 10, color: Colors.dark.textSecondary, marginTop: 4 }}>Total: {total || "—"}</Text>
                )}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function TeacherCoursesScreen() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchCourses = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("course_offerings")
        .select(`
          id,
          course:courses!course_offerings_course_id_fkey(code, title, credits, course_type),
          semester:semesters!course_offerings_semester_id_fkey(name, is_active)
        `)
        .eq("teacher_id", user.id);

      const mapped: TeacherCourse[] = [];
      for (const o of data ?? []) {
        const off = o as unknown as { id: string; course: TeacherCourse["course"]; semester: TeacherCourse["semester"] };
        const { count } = await supabase
          .from("enrollments")
          .select("id", { count: "exact", head: true })
          .eq("offering_id", off.id)
          .not("status", "eq", "dropped");
        mapped.push({ ...off, enrolled: count ?? 0 });
      }

      setCourses(mapped.sort((a, b) => (b.semester.is_active ? 1 : 0) - (a.semester.is_active ? 1 : 0)));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchCourses();
  };

  const typeColor = (t: string) => t === "theory" ? "#8b5cf6" : t === "lab" ? "#10b981" : "#f59e0b";

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.dark.background }}>
      <GlobalHeader role="teacher" title="My Courses" />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />}
      >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Courses</Text>
        <Text style={styles.subText}>View assigned courses and students</Text>
      </View>

      {courses.length === 0 ? (
        <View style={styles.emptyContainer}>
          <BookOpen size={32} color={Colors.dark.textSecondary} />
          <Text style={styles.emptyText}>No courses assigned.</Text>
        </View>
      ) : (
        <View style={styles.listContainer}>
          {courses.map(c => {
            const open = expanded === c.id;
            const color = typeColor(c.course.course_type);
            return (
              <View key={c.id} style={styles.card}>
                <TouchableOpacity
                  style={styles.cardHeader}
                  onPress={() => setExpanded(open ? null : c.id)}
                >
                  <View style={styles.codeRow}>
                    <Text style={[styles.courseCode, { color }]}>{c.course.code}</Text>
                    {c.semester.is_active && <Text style={styles.activeBadge}>Active</Text>}
                  </View>
                  <Text style={styles.courseTitle}>{c.course.title}</Text>
                  <Text style={styles.courseSub}>
                    {c.semester.name} • {c.course.credits} credits • {c.enrolled} students
                  </Text>
                </TouchableOpacity>
                {open && (
                  <StudentTable offeringId={c.id} courseType={c.course.course_type} />
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  scrollContent: { padding: Spacing.three, paddingBottom: Spacing.six },
  loadingContainer: { flex: 1, backgroundColor: Colors.dark.background, justifyContent: 'center', alignItems: 'center' },
  header: { marginBottom: Spacing.four },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.dark.text },
  subText: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 4 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six },
  emptyText: { fontSize: 13, color: Colors.dark.textSecondary, marginTop: Spacing.two },
  listContainer: { gap: Spacing.three },
  card: { backgroundColor: Colors.dark.surface, borderColor: Colors.dark.border, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  cardHeader: { padding: Spacing.three },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  courseCode: { fontSize: 12, fontFamily: Fonts.mono, fontWeight: '700' },
  activeBadge: { fontSize: 10, color: '#10b981', backgroundColor: '#10b98118', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  courseTitle: { fontSize: 15, fontWeight: '600', color: Colors.dark.text, marginBottom: 2 },
  courseSub: { fontSize: 11, color: Colors.dark.textSecondary },
  expandedContent: { borderTopWidth: 1, borderTopColor: Colors.dark.border, padding: Spacing.three, backgroundColor: Colors.dark.surfaceLight },
  placeholderText: { fontSize: 12, color: Colors.dark.textSecondary, fontStyle: 'italic', textAlign: 'center' }
});
