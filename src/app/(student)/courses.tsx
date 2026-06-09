import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Modal, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import GlobalHeader from '../../components/GlobalHeader';

import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { BookOpen, CheckCircle, Clock, XCircle, Calendar, Plus, Square, CheckSquare, Star, MessageSquare } from 'lucide-react-native';

type Course = {
  code: string;
  title: string;
  credits: number;
  course_type: string;
};

type Teacher = {
  full_name: string;
};

type Offering = {
  id: string;
  section: string;
  max_students: number;
  course: Course;
  teacher: Teacher | null;
};

type EnrollmentRecord = {
  id: string;
  offering_id: string;
  status: string;
  offering: {
    course: Course;
    teacher: Teacher | null;
    section: string;
  } | null;
};

export default function CoursesScreen() {
  const { user } = useAuth();
  
  // Navigation tabs: 'my_courses' or 'register'
  const [activeTab, setActiveTab] = useState<'my_courses' | 'register'>('my_courses');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [semesterName, setSemesterName] = useState('');
  const [canRegister, setCanRegister] = useState(false);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRecord[]>([]);
  const [selectedOfferings, setSelectedOfferings] = useState<Set<string>>(new Set());

  // Feedback states
  const [submittedFeedbackIds, setSubmittedFeedbackIds] = useState<Set<string>>(new Set());
  const [fbModalVisible, setFbModalVisible] = useState(false);
  const [fbEnrollmentId, setFbEnrollmentId] = useState('');
  const [fbCourseCode, setFbCourseCode] = useState('');
  const [fbCourseTitle, setFbCourseTitle] = useState('');
  const [fbTeacherName, setFbTeacherName] = useState('');
  const [ratingTeaching, setRatingTeaching] = useState(3);
  const [ratingContent, setRatingContent] = useState(3);
  const [ratingDifficulty, setRatingDifficulty] = useState(3);
  const [ratingOverall, setRatingOverall] = useState(3);
  const [fbComment, setFbComment] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const fetchData = async () => {
    if (!user) return;

    try {
      // 1. Get active semester
      const { data: activeSem } = await supabase
        .from('semesters')
        .select('id, name, registration_open')
        .eq('is_active', true)
        .maybeSingle();

      if (!activeSem) {
        setSemesterName('No Active Semester');
        setCanRegister(false);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      setSemesterName(activeSem.name);

      // Check registration extension
      const { data: extension } = await supabase
        .from('registration_extensions')
        .select('extended_until')
        .eq('student_id', user.id)
        .eq('semester_id', activeSem.id)
        .maybeSingle();

      const hasValidExtension = extension && new Date(extension.extended_until) >= new Date();
      setCanRegister(activeSem.registration_open || !!hasValidExtension);

      // 2. Get course offerings
      const { data: offs } = await supabase
        .from('course_offerings')
        .select('id, section, max_students, course:courses(code, title, credits, course_type), teacher:profiles!course_offerings_teacher_id_fkey(full_name)')
        .eq('semester_id', activeSem.id);

      const offeringsData = (offs ?? []) as unknown as Offering[];
      setOfferings(offeringsData);

      // 3. Get student's enrollments
      if (offeringsData.length > 0) {
        const offeringIds = offeringsData.map((o) => o.id);
        const { data: enrolled } = await supabase
          .from('enrollments')
          .select('id, offering_id, status, offering:course_offerings(section, course:courses(code, title, credits, course_type), teacher:profiles!course_offerings_teacher_id_fkey(full_name))')
          .eq('student_id', user.id)
          .in('offering_id', offeringIds);

        const enrolledList = (enrolled ?? []) as unknown as EnrollmentRecord[];
        setEnrollments(enrolledList);

        const enrollmentIds = enrolledList.map((e) => e.id);
        if (enrollmentIds.length > 0) {
          const { data: existingFb } = await supabase
            .from('course_feedback')
            .select('enrollment_id')
            .in('enrollment_id', enrollmentIds);
          
          const submittedSet = new Set((existingFb ?? []).map((f) => f.enrollment_id));
          setSubmittedFeedbackIds(submittedSet);
        } else {
          setSubmittedFeedbackIds(new Set());
        }
      } else {
        setEnrollments([]);
        setSubmittedFeedbackIds(new Set());
      }
    } catch (err) {
      console.error('Error fetching course registration details:', err);
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

  const toggleSelect = (id: string) => {
    setSelectedOfferings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRegisterSubmit = async () => {
    if (!user || selectedOfferings.size === 0) return;
    setSubmitting(true);

    try {
      const rows = Array.from(selectedOfferings).map((offeringId) => ({
        student_id: user.id,
        offering_id: offeringId,
        status: 'registered',
      }));

      const { data: inserted, error: insertErr } = await supabase
        .from('enrollments')
        .insert(rows)
        .select('id, offering_id, status');

      if (insertErr) throw insertErr;

      // Optimistically update locally
      if (inserted && inserted.length > 0) {
        const newRecords: EnrollmentRecord[] = inserted.map((e) => {
          const matched = offerings.find((o) => o.id === e.offering_id);
          return {
            id: e.id,
            offering_id: e.offering_id,
            status: e.status,
            offering: matched
              ? { course: matched.course, teacher: matched.teacher, section: matched.section }
              : null,
          };
        });
        setEnrollments((prev) => [...prev, ...newRecords]);
      }

      setSelectedOfferings(new Set());
      setActiveTab('my_courses');
    } catch (err) {
      console.error('Error saving enrollments:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const openFeedback = (rec: EnrollmentRecord) => {
    if (!rec.offering) return;
    setFbEnrollmentId(rec.id);
    setFbCourseCode(rec.offering.course.code);
    setFbCourseTitle(rec.offering.course.title);
    setFbTeacherName(rec.offering.teacher?.full_name ?? 'TBA');
    setRatingTeaching(3);
    setRatingContent(3);
    setRatingDifficulty(3);
    setRatingOverall(3);
    setFbComment('');
    setFbModalVisible(true);
  };

  const handleFeedbackSubmit = async () => {
    if (!fbEnrollmentId) return;
    setSubmittingFeedback(true);
    try {
      const { error } = await supabase
        .from('course_feedback')
        .insert({
          enrollment_id: fbEnrollmentId,
          teaching_quality: ratingTeaching,
          course_content: ratingContent,
          difficulty: ratingDifficulty,
          overall: ratingOverall,
          comment: fbComment.trim() || null,
        });

      if (error) throw error;

      setSubmittedFeedbackIds((prev) => {
        const next = new Set(prev);
        next.add(fbEnrollmentId);
        return next;
      });

      setFbModalVisible(false);
      Alert.alert('Feedback Submitted', 'Thank you for your valuable feedback!');
    } catch (err: any) {
      console.error('Error submitting feedback:', err);
      Alert.alert('Submission Failed', err.message || 'Could not submit feedback.');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const myEnrollmentIds = new Set(enrollments.map((e) => e.offering_id));
  const availableOfferings = offerings.filter((o) => !myEnrollmentIds.has(o.id));
  
  const selectedCredits = offerings
    .filter((o) => selectedOfferings.has(o.id))
    .reduce((s, o) => s + (o.course?.credits ?? 0), 0);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GlobalHeader role="student" title="My Courses" />
      {/* Sub-Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'my_courses' && styles.activeTab]}
          onPress={() => setActiveTab('my_courses')}
        >
          <Text style={[styles.tabText, activeTab === 'my_courses' && styles.activeTabText]}>Enrolled Courses</Text>
        </TouchableOpacity>
        
        {canRegister && (
          <TouchableOpacity 
            style={[styles.tab, activeTab === 'register' && styles.activeTab]}
            onPress={() => setActiveTab('register')}
          >
            <Text style={[styles.tabText, activeTab === 'register' && styles.activeTabText]}>Register New</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />
        }
      >
        {/* Semester Header */}
        <View style={styles.header}>
          <Text style={styles.semesterText}>{semesterName}</Text>
          <Text style={styles.subText}>
            {canRegister ? 'Registration active' : 'Registration closed'}
          </Text>
        </View>

        {activeTab === 'my_courses' ? (
          /* Enrolled Courses List */
          enrollments.length > 0 ? (
            <View style={styles.listContainer}>
              {enrollments.map((rec) => {
                const course = rec.offering?.course;
                const teacher = rec.offering?.teacher;
                const section = rec.offering?.section;

                const statusColor = rec.status === 'approved' ? Colors.dark.success 
                  : rec.status === 'registered' ? Colors.dark.warning
                  : Colors.dark.error;

                const statusLabel = rec.status === 'approved' ? 'Approved'
                  : rec.status === 'registered' ? 'Pending Approval'
                  : rec.status;

                return (
                  <View key={rec.id} style={styles.courseCard}>
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.codeRow}>
                          <Text style={styles.courseCode}>{course?.code ?? 'N/A'}</Text>
                          <Text style={styles.courseType}>{course?.course_type}</Text>
                        </View>
                        <Text style={styles.courseTitle}>{course?.title}</Text>
                      </View>
                      <View style={[styles.badge, { backgroundColor: statusColor + '15' }]}>
                        {rec.status === 'approved' ? (
                          <CheckCircle size={10} color={statusColor} style={{ marginRight: 4 }} />
                        ) : rec.status === 'registered' ? (
                          <Clock size={10} color={statusColor} style={{ marginRight: 4 }} />
                        ) : (
                          <XCircle size={10} color={statusColor} style={{ marginRight: 4 }} />
                        )}
                        <Text style={[styles.badgeText, { color: statusColor }]}>{statusLabel}</Text>
                      </View>
                    </View>

                    <View style={styles.cardFooter}>
                      <Text style={styles.instructorText}>Instructor: {teacher?.full_name ?? 'TBA'}</Text>
                      <Text style={styles.creditsText}>Credits: {course?.credits} • Section {section}</Text>
                    </View>

                    {rec.status === 'approved' && (
                      <View style={styles.feedbackActionRow}>
                        {submittedFeedbackIds.has(rec.id) ? (
                          <View style={styles.feedbackSubmittedContainer}>
                            <CheckCircle size={11} color={Colors.dark.success} style={{ marginRight: 6 }} />
                            <Text style={styles.feedbackSubmittedText}>Feedback Submitted</Text>
                          </View>
                        ) : (
                          <TouchableOpacity 
                            style={styles.feedbackSubmitBtn}
                            onPress={() => openFeedback(rec)}
                            activeOpacity={0.7}
                          >
                            <Star size={11} color={Colors.dark.primary} fill={Colors.dark.primary} style={{ marginRight: 6 }} />
                            <Text style={styles.feedbackSubmitBtnText}>Submit Course Feedback</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <BookOpen size={32} color={Colors.dark.textSecondary} />
              <Text style={styles.emptyText}>You haven't enrolled in any courses for this semester.</Text>
              {canRegister && (
                <TouchableOpacity style={styles.registerBtn} onPress={() => setActiveTab('register')}>
                  <Plus size={14} color={Colors.dark.text} style={{ marginRight: 4 }} />
                  <Text style={styles.registerBtnText}>Add Courses</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        ) : (
          /* Available Offerings list for registration */
          availableOfferings.length > 0 ? (
            <View>
              <View style={styles.listContainer}>
                {availableOfferings.map((o) => {
                  const isSelected = selectedOfferings.has(o.id);
                  return (
                    <TouchableOpacity 
                      key={o.id} 
                      style={[styles.offeringCard, isSelected && styles.selectedOffering]}
                      onPress={() => toggleSelect(o.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.checkboxWrapper}>
                        {isSelected ? (
                          <CheckSquare size={20} color={Colors.dark.primary} />
                        ) : (
                          <Square size={20} color={Colors.dark.borderLight} />
                        )}
                      </View>
                      
                      <View style={{ flex: 1, marginLeft: Spacing.two }}>
                        <View style={styles.codeRow}>
                          <Text style={styles.courseCode}>{o.course.code}</Text>
                          <Text style={styles.courseType}>{o.course.course_type}</Text>
                          <Text style={styles.creditsLabel}>{o.course.credits} Credits</Text>
                        </View>
                        <Text style={styles.courseTitle}>{o.course.title}</Text>
                        <Text style={styles.instructorText}>
                          Instructor: {o.teacher?.full_name ?? 'TBA'} • Section {o.section}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Submit Tally Bar */}
              <View style={styles.submitBar}>
                <View>
                  <Text style={styles.tallyText}>
                    Selected: <Text style={styles.tallyCount}>{selectedOfferings.size}</Text> courses
                  </Text>
                  {selectedOfferings.size > 0 && (
                    <Text style={styles.tallyCredits}>({selectedCredits} total credits)</Text>
                  )}
                </View>

                <TouchableOpacity 
                  style={[styles.submitBtn, selectedOfferings.size === 0 && styles.disabledSubmit]}
                  onPress={handleRegisterSubmit}
                  disabled={selectedOfferings.size === 0 || submitting}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={Colors.dark.text} />
                  ) : (
                    <Text style={styles.submitBtnText}>Submit Registration</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <BookOpen size={32} color={Colors.dark.textSecondary} />
              <Text style={styles.emptyText}>All available courses have already been requested.</Text>
            </View>
          )
        )}
      </ScrollView>

      {/* Feedback Modal */}
      <Modal
        visible={fbModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setFbModalVisible(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Course Feedback</Text>
              <TouchableOpacity onPress={() => setFbModalVisible(false)}>
                <XCircle size={20} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
              <View style={styles.fbCourseInfo}>
                <Text style={[styles.courseCode, { marginBottom: 6, alignSelf: 'flex-start' }]}>{fbCourseCode}</Text>
                <Text style={[styles.courseTitle, { marginBottom: 4 }]}>{fbCourseTitle}</Text>
                <Text style={styles.instructorText}>Instructor: {fbTeacherName}</Text>
              </View>

              {/* Star Rating Inputs */}
              {[
                { key: 'teaching', label: 'Teaching Quality', value: ratingTeaching, setValue: setRatingTeaching },
                { key: 'content', label: 'Course Content', value: ratingContent, setValue: setRatingContent },
                { key: 'difficulty', label: 'Difficulty Level', value: ratingDifficulty, setValue: setRatingDifficulty },
                { key: 'overall', label: 'Overall Experience', value: ratingOverall, setValue: setRatingOverall },
              ].map((item) => (
                <View key={item.key} style={styles.ratingRow}>
                  <Text style={styles.ratingLabel}>{item.label}</Text>
                  <View style={styles.starsContainer}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <TouchableOpacity 
                        key={star} 
                        onPress={() => item.setValue(star)}
                        style={styles.starTouch}
                      >
                        <Star 
                          size={22} 
                          color={star <= item.value ? '#f59e0b' : Colors.dark.borderLight}
                          fill={star <= item.value ? '#f59e0b' : 'none'}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}

              {/* Comment Input */}
              <View style={styles.commentContainer}>
                <Text style={styles.commentLabel}>Comments (Optional)</Text>
                <TextInput
                  style={styles.commentInput}
                  multiline={true}
                  numberOfLines={4}
                  placeholder="Share your thoughts about this course..."
                  placeholderTextColor={Colors.dark.textSecondary}
                  value={fbComment}
                  onChangeText={setFbComment}
                />
              </View>

              <TouchableOpacity 
                style={[styles.fbSubmitBtn, submittingFeedback && { opacity: 0.6 }]}
                onPress={handleFeedbackSubmit}
                disabled={submittingFeedback}
              >
                {submittingFeedback ? (
                  <ActivityIndicator size="small" color={Colors.dark.text} />
                ) : (
                  <Text style={styles.fbSubmitBtnText}>Submit Feedback</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.surface,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: Colors.dark.surfaceLight,
  },
  tabText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  activeTabText: {
    color: Colors.dark.primary,
  },
  scrollContent: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.three,
    backgroundColor: 'rgba(235, 94, 40, 0.04)',
    borderWidth: 1,
    borderColor: Colors.dark.border,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderRadius: 12,
  },
  semesterText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  subText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  listContainer: {
    gap: Spacing.three,
  },
  courseCard: {
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 18,
    padding: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.two,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
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
  courseType: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: Colors.dark.textSecondary,
    backgroundColor: Colors.dark.surfaceLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  creditsLabel: {
    fontSize: 9,
    color: Colors.dark.textSecondary,
    marginLeft: 8,
  },
  courseTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    paddingTop: Spacing.two,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  instructorText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  creditsText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  offeringCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 16,
    padding: Spacing.three,
  },
  selectedOffering: {
    borderColor: Colors.dark.primary,
    backgroundColor: 'rgba(235, 94, 40, 0.05)',
  },
  checkboxWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    marginTop: Spacing.four,
  },
  tallyText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  tallyCount: {
    fontWeight: '700',
    color: Colors.dark.text,
  },
  tallyCredits: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  submitBtn: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  disabledSubmit: {
    opacity: 0.5,
    backgroundColor: Colors.dark.borderLight,
  },
  submitBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    gap: Spacing.two,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
    lineHeight: 18,
  },
  registerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: Spacing.two,
  },
  registerBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  feedbackActionRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    paddingTop: 10,
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  feedbackSubmittedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  feedbackSubmittedText: {
    fontSize: 10.5,
    color: Colors.dark.success,
    fontWeight: '600',
  },
  feedbackSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(235, 94, 40, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(235, 94, 40, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  feedbackSubmitBtnText: {
    fontSize: 10.5,
    color: Colors.dark.primary,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.dark.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  modalScroll: {
    padding: 18,
    paddingBottom: Spacing.six,
  },
  fbCourseInfo: {
    backgroundColor: Colors.dark.surfaceLight,
    padding: 14,
    borderRadius: 12,
    marginBottom: Spacing.four,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  ratingRow: {
    marginBottom: Spacing.three,
  },
  ratingLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 6,
  },
  starTouch: {
    padding: 2,
  },
  commentContainer: {
    marginTop: Spacing.two,
    marginBottom: Spacing.four,
  },
  commentLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  commentInput: {
    backgroundColor: Colors.dark.surfaceLight,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 12,
    color: Colors.dark.text,
    padding: 12,
    fontSize: 12.5,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  fbSubmitBtn: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  fbSubmitBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
  },
});
