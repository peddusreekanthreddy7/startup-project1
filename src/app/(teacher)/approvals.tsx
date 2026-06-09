import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Alert, TextInput } from 'react-native';
import GlobalHeader from '../../components/GlobalHeader';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { Users, CheckCircle2, Clock, XCircle, CalendarDays, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react-native';

type Batch = {
  start_year: number | null;
  student_year: number | null;
  department: { id: string; name: string; code: string } | null;
};

type EnrollmentCourse = {
  enrollmentId: string;
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  credits: number;
  courseType: string;
  teacherName: string;
};

type StudentGroup = {
  studentId: string;
  fullName: string;
  rollNumber: string;
  courses: EnrollmentCourse[];
  submittedAt: string;
};

type UnregisteredStudent = {
  id: string;
  full_name: string;
  roll_number: string | null;
  branch: string | null;
};

export default function ApprovalsScreen() {
  const { user } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'unregistered'>('pending');

  const [activeSemesterId, setActiveSemesterId] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [pendingGroups, setPendingGroups] = useState<StudentGroup[]>([]);
  const [unregistered, setUnregistered] = useState<UnregisteredStudent[]>([]);

  // Action busy states
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  
  // Extension form state
  const [openExtensionStudentId, setOpenExtensionStudentId] = useState<string | null>(null);
  const [extensionDate, setExtensionDate] = useState('');
  const [extensionReason, setExtensionReason] = useState('');
  const [extensionSuccessId, setExtensionSuccessId] = useState<Set<string>>(new Set());

  const fetchApprovalsData = async () => {
    if (!user) return;

    try {
      // 1. Get active semester
      const { data: semData, error: semErr } = await supabase
        .from('semesters')
        .select('id')
        .eq('is_active', true)
        .maybeSingle();

      if (semErr) throw semErr;
      const semId = semData?.id ?? null;
      setActiveSemesterId(semId);

      // 2. Get advisor's batch assignments
      const { data: batchAdvisors, error: batchErr } = await supabase
        .from('batch_advisors')
        .select('start_year, student_year, department:departments(id, name, code)')
        .eq('advisor_id', user.id);

      if (batchErr) throw batchErr;
      const parsedBatches = (batchAdvisors as unknown as Batch[]) ?? [];
      setBatches(parsedBatches);

      if (parsedBatches.length === 0) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // 3. Match Advisor Students
      const startYearKeys = new Set<string>();
      const studentYearKeys = new Set<string>();
      const deptCodeToNames = new Map<string, string[]>();

      for (const b of parsedBatches) {
        if (!b.department) continue;
        const code = b.department.code.toUpperCase();
        if (b.start_year) startYearKeys.add(`${b.start_year}-${code}`);
        if (b.student_year) studentYearKeys.add(`${b.student_year}-${code}`);
        if (!deptCodeToNames.has(code)) deptCodeToNames.set(code, []);
        deptCodeToNames.get(code)!.push(b.department.name.toUpperCase());
      }

      // Query all students
      const { data: allStudents, error: studentsErr } = await supabase
        .from('profiles')
        .select('id, full_name, roll_number, branch, year, email, start_year, end_year')
        .eq('role', 'student');

      if (studentsErr) throw studentsErr;

      // Filter locally
      const advisorStudents = (allStudents ?? []).filter((s) => {
        let deptCode: string | null = null;
        if (s.roll_number && s.roll_number.length >= 5) {
          deptCode = s.roll_number.substring(3, 5).toUpperCase();
        }

        // Match by start_year
        if (s.start_year && deptCode && startYearKeys.has(`${s.start_year}-${deptCode}`)) return true;

        // Match by start_year + branch
        if (s.start_year && s.branch) {
          const branchUp = s.branch.toUpperCase();
          for (const [code, names] of deptCodeToNames.entries()) {
            if (startYearKeys.has(`${s.start_year}-${code}`)) {
              if (branchUp.includes(code) || names.some((n) => branchUp.includes(n) || n.includes(branchUp))) return true;
            }
          }
        }

        // Match by student_year (legacy)
        if (s.year && !s.start_year) {
          const yearNum = parseInt(s.year);
          if (!isNaN(yearNum)) {
            if (deptCode && studentYearKeys.has(`${yearNum}-${deptCode}`)) return true;
            if (s.branch) {
              const branchUp = s.branch.toUpperCase();
              for (const [code, names] of deptCodeToNames.entries()) {
                if (studentYearKeys.has(`${yearNum}-${code}`)) {
                  if (branchUp.includes(code) || names.some((n) => branchUp.includes(n) || n.includes(branchUp))) return true;
                }
              }
            }
          }
        }

        return false;
      });

      const studentIds = advisorStudents.map((s) => s.id);

      if (studentIds.length > 0) {
        // 4. Get pending registrations
        const { data: enrollments, error: enrollErr } = await supabase
          .from('enrollments')
          .select(`
            id, offering_id, created_at,
            student:profiles!enrollments_student_id_fkey(id, full_name, roll_number),
            offering:course_offerings!enrollments_offering_id_fkey(
              id,
              course:courses!course_offerings_course_id_fkey(code, title, credits, course_type),
              teacher:profiles!course_offerings_teacher_id_fkey(full_name)
            )
          `)
          .eq('status', 'registered')
          .in('student_id', studentIds);

        if (enrollErr) throw enrollErr;

        // Group by student
        const groupMap = new Map<string, StudentGroup>();

        for (const e of (enrollments ?? [])) {
          const student = e.student as unknown as { id: string; full_name: string; roll_number: string } | null;
          const offering = e.offering as unknown as {
            id: string;
            course: { code: string; title: string; credits: number; course_type: string } | null;
            teacher: { full_name: string } | null;
          } | null;

          if (!student) continue;

          if (!groupMap.has(student.id)) {
            groupMap.set(student.id, {
              studentId: student.id,
              fullName: student.full_name,
              rollNumber: student.roll_number ?? '?',
              courses: [],
              submittedAt: e.created_at,
            });
          }

          groupMap.get(student.id)!.courses.push({
            enrollmentId: e.id,
            offeringId: e.offering_id,
            courseCode: offering?.course?.code ?? '?',
            courseTitle: offering?.course?.title ?? '?',
            credits: offering?.course?.credits ?? 0,
            courseType: offering?.course?.course_type ?? 'theory',
            teacherName: offering?.teacher?.full_name ?? 'TBA',
          });
        }

        setPendingGroups(Array.from(groupMap.values()));

        // 5. Get unregistered students for active semester
        if (semId) {
          const { data: semOfferings } = await supabase
            .from('course_offerings')
            .select('id')
            .eq('semester_id', semId);

          const offeringIds = (semOfferings ?? []).map((o) => o.id);

          if (offeringIds.length > 0) {
            const { data: enrolled } = await supabase
              .from('enrollments')
              .select('student_id')
              .in('offering_id', offeringIds)
              .not('status', 'eq', 'dropped')
              .in('student_id', studentIds);

            const enrolledIds = new Set((enrolled ?? []).map((e) => e.student_id));
            const filteredUnregistered = advisorStudents.filter((s) => !enrolledIds.has(s.id));
            setUnregistered(filteredUnregistered as unknown as UnregisteredStudent[]);
          } else {
            setUnregistered(advisorStudents as unknown as UnregisteredStudent[]);
          }
        }
      } else {
        setPendingGroups([]);
        setUnregistered([]);
      }
    } catch (err) {
      console.error('Error loading advisor approvals:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchApprovalsData();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchApprovalsData();
  };

  const handleApproveAll = async (group: StudentGroup) => {
    setBusyGroupId(group.studentId);
    const ids = group.courses.map((c) => c.enrollmentId);

    try {
      const { error } = await supabase
        .from('enrollments')
        .update({ status: 'approved' })
        .in('id', ids);

      if (error) throw error;
      Alert.alert('Success', `Approved all courses for ${group.fullName}`);
      fetchApprovalsData();
    } catch (err: any) {
      Alert.alert('Approval Failed', err.message || 'Error occurred.');
    } finally {
      setBusyGroupId(null);
    }
  };

  const handleRejectAll = async (group: StudentGroup) => {
    setBusyGroupId(group.studentId);
    const ids = group.courses.map((c) => c.enrollmentId);

    try {
      const { error } = await supabase
        .from('enrollments')
        .update({ status: 'rejected' })
        .in('id', ids);

      if (error) throw error;
      Alert.alert('Success', `Rejected courses for ${group.fullName}`);
      fetchApprovalsData();
    } catch (err: any) {
      Alert.alert('Rejection Failed', err.message || 'Error occurred.');
    } finally {
      setBusyGroupId(null);
    }
  };

  const handleGrantExtension = async (studentId: string) => {
    if (!activeSemesterId || !extensionDate || !extensionReason.trim()) {
      Alert.alert('Missing Fields', 'Please select extension date and provide reasoning.');
      return;
    }

    try {
      const { error } = await supabase
        .from('registration_extensions')
        .upsert(
          {
            student_id: studentId,
            semester_id: activeSemesterId,
            extended_until: extensionDate,
            granted_by: user?.id,
            reason: extensionReason.trim(),
          },
          { onConflict: 'student_id,semester_id' }
        );

      if (error) throw error;

      setExtensionSuccessId((prev) => new Set([...prev, studentId]));
      setOpenExtensionStudentId(null);
      setExtensionDate('');
      setExtensionReason('');
      Alert.alert('Extension Granted', 'Successfully extended registration window.');
    } catch (err: any) {
      Alert.alert('Failed', err.message || 'Error occurred.');
    }
  };

  const batchLabel = batches.length === 0
    ? 'No advisor batch assignments found.'
    : batches.map((b) => `${b.department?.code ?? '?'} ${b.start_year ?? ''}`).join(' · ');

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.dark.background }}>
      <GlobalHeader role="teacher" title="Student Approvals" />
      <View style={styles.container}>
      {/* Sub-Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'pending' && styles.activeTab]}
          onPress={() => setActiveTab('pending')}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.tabText, activeTab === 'pending' && styles.activeTabText]}>Pending Approvals</Text>
            {pendingGroups.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{pendingGroups.length}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'unregistered' && styles.activeTab]}
          onPress={() => setActiveTab('unregistered')}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.tabText, activeTab === 'unregistered' && styles.activeTabText]}>Not Registered</Text>
            {unregistered.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{unregistered.length}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />
        }
      >
        {/* Advisor Details */}
        <View style={styles.batchInfoBox}>
          <Text style={styles.batchLabelText}>Assigned Batches</Text>
          <Text style={styles.batchesText}>{batchLabel}</Text>
        </View>

        {activeTab === 'pending' ? (
          /* Pending Groups List */
          pendingGroups.length > 0 ? (
            pendingGroups.map((group) => {
              const totalCredits = group.courses.reduce((sum, c) => sum + c.credits, 0);
              const isBusy = busyGroupId === group.studentId;

              return (
                <View key={group.studentId} style={styles.studentCard}>
                  <View style={styles.cardHeader}>
                    <View>
                      <Text style={styles.fullName}>{group.fullName}</Text>
                      <Text style={styles.rollNumber}>{group.rollNumber}</Text>
                    </View>
                    <View style={styles.timeBadge}>
                      <Clock size={11} color={Colors.dark.textSecondary} style={{ marginRight: 4 }} />
                      <Text style={styles.timeBadgeText}>Submitted</Text>
                    </View>
                  </View>

                  <View style={styles.coursesList}>
                    {group.courses.map((c) => (
                      <View key={c.enrollmentId} style={styles.courseRow}>
                        <View style={styles.codeBadge}>
                          <Text style={styles.codeBadgeText}>{c.courseCode}</Text>
                        </View>
                        <View style={{ flex: 1, marginLeft: 8 }}>
                          <Text style={styles.courseTitle} numberOfLines={1}>{c.courseTitle}</Text>
                          <Text style={styles.courseSub}>
                            {c.credits} Credits • {c.courseType} • {c.teacherName}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  <View style={styles.cardFooter}>
                    <Text style={styles.totalCreditsText}>
                      Total: <Text style={{ fontWeight: '700', color: Colors.dark.text }}>{totalCredits} Credits</Text>
                    </Text>
                    
                    <View style={styles.actionRow}>
                      <TouchableOpacity 
                        style={[styles.rejectBtn, isBusy && styles.disabledBtn]}
                        onPress={() => handleRejectAll(group)}
                        disabled={isBusy}
                      >
                        <Text style={styles.rejectBtnText}>Reject</Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity 
                        style={[styles.approveBtn, isBusy && styles.disabledBtn]}
                        onPress={() => handleApproveAll(group)}
                        disabled={isBusy}
                      >
                        <Text style={styles.approveBtnText}>Approve</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.emptyContainer}>
              <CheckCircle2 size={36} color={Colors.dark.success} />
              <Text style={styles.emptyTitle}>All caught up!</Text>
              <Text style={styles.emptySubtitle}>No pending student registration requests found.</Text>
            </View>
          )
        ) : (
          /* Unregistered List */
          unregistered.length > 0 ? (
            <View style={styles.listCard}>
              {unregistered.map((student, index) => {
                const isOpen = openExtensionStudentId === student.id;
                const wasGranted = extensionSuccessId.has(student.id);

                return (
                  <View key={student.id} style={[styles.unregisteredRow, index > 0 && styles.borderTop]}>
                    <View style={styles.unregisteredHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fullName}>{student.full_name}</Text>
                        <Text style={styles.rollNumber}>
                          {student.roll_number ?? 'No roll number'} {student.branch ? `• ${student.branch}` : ''}
                        </Text>
                      </View>

                      {wasGranted ? (
                        <View style={[styles.badge, styles.grantedBadge]}>
                          <CheckCircle size={10} color={Colors.dark.success} style={{ marginRight: 4 }} />
                          <Text style={styles.grantedBadgeText}>Extended</Text>
                        </View>
                      ) : activeSemesterId ? (
                        <TouchableOpacity 
                          style={styles.extendBtn}
                          onPress={() => setOpenExtensionStudentId(isOpen ? null : student.id)}
                        >
                          <CalendarDays size={12} color={Colors.dark.primary} style={{ marginRight: 4 }} />
                          <Text style={styles.extendBtnText}>Extend</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {/* Inline Form */}
                    {isOpen && (
                      <View style={styles.extensionForm}>
                        <Text style={styles.formLabel}>Extend until (YYYY-MM-DD):</Text>
                        <TextInput
                          style={styles.formInput}
                          placeholder="e.g. 2026-06-30"
                          placeholderTextColor="#4A4745"
                          value={extensionDate}
                          onChangeText={setExtensionDate}
                        />

                        <Text style={styles.formLabel}>Reason:</Text>
                        <TextInput
                          style={styles.formInput}
                          placeholder="e.g. Medical leave extension"
                          placeholderTextColor="#4A4745"
                          value={extensionReason}
                          onChangeText={setExtensionReason}
                        />

                        <View style={styles.formActions}>
                          <TouchableOpacity 
                            style={styles.formCancelBtn}
                            onPress={() => setOpenExtensionStudentId(null)}
                          >
                            <Text style={styles.formCancelText}>Cancel</Text>
                          </TouchableOpacity>
                          
                          <TouchableOpacity 
                            style={styles.formSaveBtn}
                            onPress={() => handleGrantExtension(student.id)}
                          >
                            <Text style={styles.formSaveText}>Grant</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <CheckCircle2 size={36} color={Colors.dark.success} />
              <Text style={styles.emptyTitle}>Registration Complete</Text>
              <Text style={styles.emptySubtitle}>All students in your batches are successfully registered.</Text>
            </View>
          )
        )}
      </ScrollView>
    </View>
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
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.dark.primary,
  },
  tabText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  activeTabText: {
    color: Colors.dark.primary,
  },
  countBadge: {
    backgroundColor: 'rgba(235, 94, 40, 0.12)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    marginLeft: 6,
  },
  countText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: Colors.dark.primary,
  },
  scrollContent: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
  },
  batchInfoBox: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    marginBottom: Spacing.three,
  },
  batchLabelText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.dark.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  batchesText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  studentCard: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    paddingBottom: Spacing.two,
    marginBottom: Spacing.two,
  },
  fullName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  rollNumber: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  timeBadgeText: {
    fontSize: 9.5,
    fontWeight: '600',
    color: Colors.dark.warning,
  },
  coursesList: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  courseRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  codeBadge: {
    backgroundColor: 'rgba(235, 94, 40, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 4,
    width: 54,
    alignItems: 'center',
  },
  codeBadgeText: {
    fontSize: 9.5,
    fontFamily: Fonts.mono,
    fontWeight: '700',
    color: Colors.dark.primary,
  },
  courseTitle: {
    fontSize: 12.5,
    fontWeight: '500',
    color: Colors.dark.text,
  },
  courseSub: {
    fontSize: 10.5,
    color: Colors.dark.textSecondary,
    marginTop: 1.5,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    paddingTop: Spacing.two,
    marginTop: Spacing.two,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalCreditsText: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  rejectBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  rejectBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.error,
  },
  approveBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  approveBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.success,
  },
  disabledBtn: {
    opacity: 0.5,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  emptySubtitle: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
  },
  listCard: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  unregisteredRow: {
    padding: Spacing.three,
  },
  unregisteredHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  grantedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  grantedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.dark.success,
  },
  extendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surfaceLight,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  extendBtnText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: Colors.dark.primary,
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  extensionForm: {
    backgroundColor: Colors.dark.surfaceLight,
    borderRadius: 10,
    padding: 10,
    marginTop: Spacing.two,
    gap: 6,
  },
  formLabel: {
    fontSize: 10.5,
    color: Colors.dark.textSecondary,
    fontWeight: '600',
  },
  formInput: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    color: Colors.dark.text,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  formCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  formCancelText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  formSaveBtn: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  formSaveText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.text,
  },
});
