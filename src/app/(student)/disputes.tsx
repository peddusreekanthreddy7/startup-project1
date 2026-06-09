import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import GlobalHeader from '../../components/GlobalHeader';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { Scale, CheckCircle, Clock, ExternalLink } from 'lucide-react-native';
import { useRouter } from 'expo-router';

type Objection = {
  id: string;
  text: string;
  qno: string | null;
  status: 'sent' | 'review' | 'updated';
  raised_at: string;
  updated_marks: number | null;
  script: {
    id: string;
    total_awarded: number | null;
    exam: {
      title: string;
      subject: string;
      total_marks: number;
    } | null;
  } | null;
};

export default function DisputesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [objections, setObjections] = useState<Objection[]>([]);

  const fetchObjections = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('paper_objections')
        .select(`
          id,
          text,
          qno,
          status,
          raised_at,
          updated_marks,
          script:answer_scripts!script_id(
            id,
            total_awarded,
            exam:exams!exam_id(
              title,
              subject,
              total_marks
            )
          )
        `)
        .eq('student_id', user.id)
        .order('raised_at', { ascending: false });

      if (error) throw error;
      setObjections((data as unknown as Objection[]) ?? []);
    } catch (err) {
      console.error('Error fetching objections:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchObjections();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchObjections();
  };

  const getStatusBadge = (status: string, updatedMarks: number | null) => {
    if (status === 'updated') {
      return (
        <View style={[styles.badge, styles.successBadge]}>
          <CheckCircle size={10} color={Colors.dark.success} style={{ marginRight: 4 }} />
          <Text style={styles.successBadgeText}>
            {updatedMarks != null ? `Updated: ${updatedMarks}` : 'Marks Updated'}
          </Text>
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
        <Text style={styles.submittedBadgeText}>Submitted</Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GlobalHeader role="student" title="Disputes" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.titleText}>Disputes Center</Text>
          <Text style={styles.subText}>Track raised objections and evaluation grading corrections</Text>
        </View>

        {objections.length > 0 ? (
          <View style={styles.listContainer}>
            {objections.map((o) => {
              const formattedDate = new Date(o.raised_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });

              return (
                <View key={o.id} style={styles.objectionCard}>
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <Text style={styles.examTitle}>{o.script?.exam?.title ?? 'Exam'}</Text>
                        {o.qno && (
                          <View style={styles.qnoBadge}>
                            <Text style={styles.qnoBadgeText}>Q{o.qno}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.examSubject}>
                        {o.script?.exam?.subject} • Raised {formattedDate}
                      </Text>
                    </View>
                    
                    {getStatusBadge(o.status, o.updated_marks)}
                  </View>

                  <View style={styles.cardBody}>
                    <Text style={styles.objectionText}>{o.text}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <Scale size={42} color={Colors.dark.textSecondary} style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>No disputes active</Text>
            <Text style={styles.emptySubtitle}>
              To raise an objection, navigate to a graded answer script in the Scripts tab and select "Object".
            </Text>
            <TouchableOpacity 
              style={styles.actionBtn}
              onPress={() => router.push('/(student)/scripts')}
            >
              <ExternalLink size={14} color={Colors.dark.text} style={{ marginRight: 6 }} />
              <Text style={styles.actionBtnText}>Go to Answer Scripts</Text>
            </TouchableOpacity>
          </View>
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
    marginBottom: Spacing.four,
  },
  titleText: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  subText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 4,
  },
  listContainer: {
    gap: Spacing.three,
  },
  objectionCard: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
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
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    paddingBottom: Spacing.two,
    marginBottom: Spacing.two,
  },
  examTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  qnoBadge: {
    backgroundColor: 'rgba(235, 94, 40, 0.12)',
    borderColor: 'rgba(235, 94, 40, 0.25)',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  qnoBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: Colors.dark.primary,
  },
  examSubject: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
    marginTop: 2,
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
  cardBody: {
    paddingLeft: Spacing.one,
  },
  objectionText: {
    fontSize: 12.5,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: Spacing.four,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.dark.text,
  },
});
