import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import GlobalHeader from '../../components/GlobalHeader';
import { useAuth } from '../../context/AuthContext';
import { Colors, Spacing } from '../../constants/theme';
import { User, Mail, CreditCard, LogOut, BookOpen, Calendar, Info } from 'lucide-react-native';

export default function StudentSettings() {
  const { profile, signOut } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: Colors.dark.background }}>
      <GlobalHeader role="student" title="Settings" />
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <User size={36} color={Colors.dark.primary} />
        </View>
        <Text style={styles.nameText}>{profile?.full_name ?? 'Student Profile'}</Text>
        <Text style={styles.roleBadge}>Student Portal</Text>
      </View>

      {/* Info Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account Details</Text>
        
        {/* Email */}
        <View style={styles.infoRow}>
          <Mail size={16} color={Colors.dark.textSecondary} style={styles.icon} />
          <View style={styles.infoBody}>
            <Text style={styles.infoLabel}>College Email</Text>
            <Text style={styles.infoValue}>{profile?.email ?? 'N/A'}</Text>
          </View>
        </View>

        {/* Roll Number */}
        {profile?.roll_number && (
          <View style={[styles.infoRow, styles.borderTop]}>
            <CreditCard size={16} color={Colors.dark.textSecondary} style={styles.icon} />
            <View style={styles.infoBody}>
              <Text style={styles.infoLabel}>Roll Number</Text>
              <Text style={styles.infoValue}>{profile.roll_number}</Text>
            </View>
          </View>
        )}

        {/* Branch / Dept */}
        {profile?.branch && (
          <View style={[styles.infoRow, styles.borderTop]}>
            <BookOpen size={16} color={Colors.dark.textSecondary} style={styles.icon} />
            <View style={styles.infoBody}>
              <Text style={styles.infoLabel}>Branch / Major</Text>
              <Text style={styles.infoValue}>{profile.branch}</Text>
            </View>
          </View>
        )}

        {/* Year */}
        {profile?.year && (
          <View style={[styles.infoRow, styles.borderTop]}>
            <Calendar size={16} color={Colors.dark.textSecondary} style={styles.icon} />
            <View style={styles.infoBody}>
              <Text style={styles.infoLabel}>Current Academic Year</Text>
              <Text style={styles.infoValue}>Year {profile.year}</Text>
            </View>
          </View>
        )}
      </View>

      {/* About Box */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Platform Info</Text>
        <View style={styles.infoRow}>
          <Info size={16} color={Colors.dark.textSecondary} style={styles.icon} />
          <View style={styles.infoBody}>
            <Text style={styles.infoLabel}>App Version</Text>
            <Text style={styles.infoValue}>v1.0.0 (Expo Mobile Platform)</Text>
          </View>
        </View>
        <View style={[styles.infoRow, styles.borderTop]}>
          <Text style={styles.aboutText}>
            Askd is an advanced AI-powered evaluation system designed to eliminate scoring discrepancies, automate paper analysis, and facilitate direct teacher-student feedback loops.
          </Text>
        </View>
      </View>

      {/* Actions */}
      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <LogOut size={16} color={Colors.dark.text} style={{ marginRight: 8 }} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
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
  header: {
    alignItems: 'center',
    marginVertical: Spacing.four,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  nameText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  roleBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.primary,
    backgroundColor: 'rgba(235, 94, 40, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 6,
  },
  card: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.three,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    paddingTop: Spacing.two,
    marginTop: Spacing.one,
  },
  icon: {
    marginRight: Spacing.three,
  },
  infoBody: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.dark.text,
  },
  aboutText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.primary,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: Spacing.two,
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.text,
  },
});
