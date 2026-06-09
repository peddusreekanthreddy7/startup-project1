import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { BookOpen, User, Edit, CheckCircle, ChevronRight, XCircle } from 'lucide-react-native';

type Offering = {
  id: string;
  section: string;
  course: { code: string; title: string; course_type: string; };
  semester: { name: string; is_active: boolean; };
};

type Enrollment = {
  id: string;
  student: { id: string; full_name: string; roll_number: string; };
  marks: {
    id: string;
    internal_marks: number | null;
    midsem_marks: number | null;
    endsem_marks: number | null;
    grade: string | null;
  } | null;
};

export default function TeacherGradesScreen() {
  const { user } = useAuth();
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedOffering, setSelectedOffering] = useState<Offering | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [activeEnrollment, setActiveEnrollment] = useState<Enrollment | null>(null);
  const [internal, setInternal] = useState('');
  const [midsem, setMidsem] = useState('');
  const [endsem, setEndsem] = useState('');
  const [grade, setGrade] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchOfferings = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('course_offerings')
        .select(`
          id, section,
          course:courses(code, title, course_type),
          semester:semesters(name, is_active)
        `)
        .eq('teacher_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOfferings(data as any);
    } catch (err) {
      console.error('Error fetching offerings:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchEnrollments = async (offeringId: string) => {
    setLoadingEnrollments(true);
    try {
      const { data: enrData, error: enrErr } = await supabase
        .from('enrollments')
        .select(`
          id,
          student:profiles!enrollments_student_id_fkey(id, full_name, roll_number)
        `)
        .eq('offering_id', offeringId)
        .eq('status', 'approved');

      if (enrErr) throw enrErr;

      const enrIds = enrData.map((e: any) => e.id);
      let marksMap: Record<string, any> = {};

      if (enrIds.length > 0) {
        const { data: marksData } = await supabase
          .from('student_marks')
          .select('*')
          .in('enrollment_id', enrIds);
        
        marksData?.forEach(m => {
          marksMap[m.enrollment_id] = m;
        });
      }

      const merged = enrData.map((e: any) => ({
        ...e,
        marks: marksMap[e.id] || null
      }));

      setEnrollments(merged);
    } catch (err) {
      console.error('Error fetching enrollments:', err);
    } finally {
      setLoadingEnrollments(false);
    }
  };

  useEffect(() => {
    fetchOfferings();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    if (!selectedOffering) {
      fetchOfferings();
    } else {
      fetchEnrollments(selectedOffering.id);
      setRefreshing(false);
    }
  };

  const openEditor = (enr: Enrollment) => {
    setActiveEnrollment(enr);
    setInternal(enr.marks?.internal_marks?.toString() || '');
    setMidsem(enr.marks?.midsem_marks?.toString() || '');
    setEndsem(enr.marks?.endsem_marks?.toString() || '');
    setGrade(enr.marks?.grade || '');
    setModalVisible(true);
  };

  const handleSaveMarks = async () => {
    if (!activeEnrollment) return;
    setIsSaving(true);
    try {
      const payload = {
        enrollment_id: activeEnrollment.id,
        internal_marks: internal ? parseFloat(internal) : null,
        midsem_marks: midsem ? parseFloat(midsem) : null,
        endsem_marks: endsem ? parseFloat(endsem) : null,
        grade: grade.trim().toUpperCase() || null,
        updated_at: new Date().toISOString()
      };

      if (activeEnrollment.marks?.id) {
        // Update
        const { error } = await supabase
          .from('student_marks')
          .update(payload)
          .eq('id', activeEnrollment.marks.id);
        if (error) throw error;
      } else {
        // Insert
        const { error } = await supabase
          .from('student_marks')
          .insert(payload);
        if (error) throw error;
      }

      setModalVisible(false);
      fetchEnrollments(selectedOffering!.id);
      Alert.alert('Success', 'Marks updated successfully.');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Grade Entry</Text>
          <Text style={styles.subText}>Manage student marks manually</Text>
        </View>

        {!selectedOffering ? (
          <View>
            <Text style={styles.sectionTitle}>Your Course Offerings</Text>
            {offerings.length > 0 ? (
              <View style={styles.listContainer}>
                {offerings.map(o => (
                  <TouchableOpacity 
                    key={o.id} 
                    style={styles.card}
                    onPress={() => {
                      setSelectedOffering(o);
                      fetchEnrollments(o.id);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Text style={styles.codeBadge}>{o.course.code}</Text>
                        <Text style={styles.semBadge}>{o.semester.name}</Text>
                      </View>
                      <Text style={styles.courseTitle}>{o.course.title}</Text>
                      <Text style={styles.sectionText}>Section {o.section} • {o.course.course_type}</Text>
                    </View>
                    <ChevronRight size={18} color={Colors.dark.textSecondary} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <BookOpen size={32} color={Colors.dark.textSecondary} />
                <Text style={styles.emptyText}>No course offerings assigned.</Text>
              </View>
            )}
          </View>
        ) : (
          <View>
            <TouchableOpacity 
              style={styles.backBtn}
              onPress={() => setSelectedOffering(null)}
            >
              <Text style={styles.backBtnText}>← Back to Offerings</Text>
            </TouchableOpacity>

            <View style={styles.offeringHeader}>
              <Text style={styles.offeringHeaderCode}>{selectedOffering.course.code}</Text>
              <Text style={styles.offeringHeaderTitle}>{selectedOffering.course.title}</Text>
              <Text style={styles.offeringHeaderSub}>Section {selectedOffering.section}</Text>
            </View>

            {loadingEnrollments ? (
              <ActivityIndicator size="small" color={Colors.dark.primary} style={{ marginTop: 20 }} />
            ) : enrollments.length > 0 ? (
              <View style={styles.enrollmentList}>
                {enrollments.map(enr => {
                  const hasGrade = !!enr.marks?.grade;
                  return (
                    <TouchableOpacity 
                      key={enr.id} 
                      style={styles.studentCard}
                      onPress={() => openEditor(enr)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.studentName}>{enr.student.full_name}</Text>
                        <Text style={styles.studentRoll}>{enr.student.roll_number}</Text>
                        <View style={styles.marksRow}>
                          <Text style={styles.marksLabel}>Int: {enr.marks?.internal_marks ?? '-'}</Text>
                          <Text style={styles.marksLabel}>Mid: {enr.marks?.midsem_marks ?? '-'}</Text>
                          <Text style={styles.marksLabel}>End: {enr.marks?.endsem_marks ?? '-'}</Text>
                        </View>
                      </View>
                      <View style={[styles.gradeCircle, hasGrade && styles.gradeCircleFilled]}>
                        <Text style={[styles.gradeText, hasGrade && { color: Colors.dark.primary }]}>
                          {enr.marks?.grade || '?'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <User size={32} color={Colors.dark.textSecondary} />
                <Text style={styles.emptyText}>No students enrolled.</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Editor Modal */}
      <Modal visible={modalVisible} transparent={true} animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Enter Marks</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <XCircle size={20} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            </View>

            {activeEnrollment && (
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.studentName}>{activeEnrollment.student.full_name}</Text>
                <Text style={styles.studentRoll}>{activeEnrollment.student.roll_number}</Text>
              </View>
            )}

            <View style={styles.inputGroup}>
              <View style={styles.inputCol}>
                <Text style={styles.inputLabel}>Internal</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={internal} onChangeText={setInternal} placeholder="0-20" placeholderTextColor={Colors.dark.borderLight} />
              </View>
              <View style={styles.inputCol}>
                <Text style={styles.inputLabel}>Midsem</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={midsem} onChangeText={setMidsem} placeholder="0-30" placeholderTextColor={Colors.dark.borderLight} />
              </View>
              <View style={styles.inputCol}>
                <Text style={styles.inputLabel}>Endsem</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={endsem} onChangeText={setEndsem} placeholder="0-50" placeholderTextColor={Colors.dark.borderLight} />
              </View>
            </View>

            <View style={{ marginBottom: 20 }}>
              <Text style={styles.inputLabel}>Final Grade</Text>
              <TextInput style={styles.inputGrade} autoCapitalize="characters" value={grade} onChangeText={setGrade} placeholder="e.g. A+" placeholderTextColor={Colors.dark.borderLight} maxLength={2} />
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveMarks} disabled={isSaving}>
              {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Marks</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  scrollContent: { padding: Spacing.three, paddingBottom: Spacing.six },
  header: { marginBottom: Spacing.four },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.dark.text },
  subText: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.dark.text, marginBottom: Spacing.three },
  listContainer: { gap: Spacing.three },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.dark.surface, borderWidth: 1, borderColor: Colors.dark.border, borderRadius: 16, padding: Spacing.three },
  codeBadge: { fontSize: 10, fontFamily: Fonts.mono, color: Colors.dark.primary, backgroundColor: 'rgba(235, 94, 40, 0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontWeight: '700' },
  semBadge: { fontSize: 10, color: Colors.dark.textSecondary, backgroundColor: Colors.dark.surfaceLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  courseTitle: { fontSize: 14, fontWeight: '600', color: Colors.dark.text, marginBottom: 4 },
  sectionText: { fontSize: 11, color: Colors.dark.textSecondary },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six, gap: 12 },
  emptyText: { fontSize: 13, color: Colors.dark.textSecondary },
  backBtn: { marginBottom: Spacing.three, alignSelf: 'flex-start' },
  backBtnText: { fontSize: 12, color: Colors.dark.primary, fontWeight: '600' },
  offeringHeader: { backgroundColor: Colors.dark.surfaceLight, padding: 16, borderRadius: 12, marginBottom: Spacing.four },
  offeringHeaderCode: { fontSize: 12, fontFamily: Fonts.mono, color: Colors.dark.primary, fontWeight: '700', marginBottom: 2 },
  offeringHeaderTitle: { fontSize: 16, fontWeight: '700', color: Colors.dark.text, marginBottom: 2 },
  offeringHeaderSub: { fontSize: 11, color: Colors.dark.textSecondary },
  enrollmentList: { gap: Spacing.two },
  studentCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.dark.surface, borderWidth: 1, borderColor: Colors.dark.border, borderRadius: 12, padding: 12 },
  studentName: { fontSize: 13, fontWeight: '600', color: Colors.dark.text },
  studentRoll: { fontSize: 11, fontFamily: Fonts.mono, color: Colors.dark.textSecondary, marginTop: 2, marginBottom: 6 },
  marksRow: { flexDirection: 'row', gap: 12 },
  marksLabel: { fontSize: 10, color: Colors.dark.textSecondary, backgroundColor: Colors.dark.surfaceLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  gradeCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.dark.surfaceLight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.dark.border },
  gradeCircleFilled: { borderColor: Colors.dark.primary, backgroundColor: 'rgba(235, 94, 40, 0.05)' },
  gradeText: { fontSize: 13, fontWeight: '700', color: Colors.dark.textSecondary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', backgroundColor: Colors.dark.surface, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: Colors.dark.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.dark.text },
  inputGroup: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  inputCol: { flex: 1 },
  inputLabel: { fontSize: 11, color: Colors.dark.textSecondary, marginBottom: 6 },
  input: { backgroundColor: Colors.dark.surfaceLight, borderWidth: 1, borderColor: Colors.dark.border, borderRadius: 8, padding: 10, color: Colors.dark.text, fontFamily: Fonts.mono, fontSize: 14, textAlign: 'center' },
  inputGrade: { backgroundColor: Colors.dark.surfaceLight, borderWidth: 1, borderColor: Colors.dark.border, borderRadius: 8, padding: 10, color: Colors.dark.primary, fontFamily: Fonts.mono, fontSize: 16, fontWeight: '700', textAlign: 'center', width: 80 },
  saveBtn: { backgroundColor: Colors.dark.primary, padding: 14, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' }
});
