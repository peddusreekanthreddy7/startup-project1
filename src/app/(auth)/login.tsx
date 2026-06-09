import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing } from '../../constants/theme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Mail, CreditCard, User, Eye, EyeOff, Lock, Award, BookOpen } from 'lucide-react-native';

const { width } = Dimensions.get('window');

type Role = 'student' | 'teacher' | 'admin';
type StudentTab = 'email' | 'roll';
type TeacherTab = 'email' | 'empId';

export default function LoginScreen() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('student');
  const [studentTab, setStudentTab] = useState<StudentTab>('email');
  const [teacherTab, setTeacherTab] = useState<TeacherTab>('email');

  const [email, setEmail] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setError('');
    setLoading(true);

    try {
      let loginEmail = '';

      // Determine the email based on the login mode
      if (role === 'student') {
        if (studentTab === 'email') {
          if (!email) throw new Error('Please enter your college email.');
          loginEmail = email.trim();
        } else {
          if (!rollNumber) throw new Error('Please enter your roll number.');
          // Query roll number to get email
          const { data: profile, error: lookupErr } = await supabase
            .from('profiles')
            .select('email')
            .eq('roll_number', rollNumber.trim())
            .maybeSingle();

          if (lookupErr || !profile) {
            throw new Error('Roll number not found. Make sure you have registered.');
          }
          loginEmail = profile.email;
        }
      } else {
        // Teacher flow
        if (teacherTab === 'email') {
          if (!email) throw new Error('Please enter your college email.');
          loginEmail = email.trim();
        } else {
          if (!employeeId) throw new Error('Please enter your employee ID.');
          // Query employee ID to get email
          const { data: profile, error: lookupErr } = await supabase
            .from('profiles')
            .select('email')
            .eq('employee_id', employeeId.trim())
            .maybeSingle();

          if (lookupErr || !profile) {
            throw new Error('Employee ID not found. Make sure you have registered.');
          }
          loginEmail = profile.email;
        }
      }

      if (!password) throw new Error('Please enter your password.');

      // Sign in
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: password,
      });

      if (signInErr) throw signInErr;

      // Verify profile and role
      if (data.user) {
        const { data: profile, error: profileErr } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .single();

        if (profileErr) throw new Error('Error retrieving user profile.');
        if (profile?.role !== role) {
          // Sign out immediately if wrong portal used
          await supabase.auth.signOut();
          throw new Error(`This account is registered as a ${profile?.role}. Please use the ${profile?.role} portal.`);
        }
      }

    } catch (err: any) {
      setError(err.message || 'An error occurred during login.');
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          
          {/* Header */}
          <View style={styles.headerContainer}>
            <View style={styles.logoBadge}>
              <Award size={36} color={Colors.dark.primary} />
            </View>
            <Text style={styles.titleText}>Askd Platform</Text>
            <Text style={styles.subtitleText}>Turning evaluation into evolution</Text>
          </View>

          {/* Role Selectors */}
          <View style={styles.roleContainer}>
            <TouchableOpacity 
              style={[styles.roleTab, role === 'student' && styles.activeRoleTab]}
              onPress={() => { setRole('student'); setError(''); }}
            >
              <User size={16} color={role === 'student' ? Colors.dark.primary : Colors.dark.textSecondary} style={{ marginRight: 4 }} />
              <Text style={[styles.roleTabText, role === 'student' && styles.activeRoleText]}>Student</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.roleTab, role === 'teacher' && styles.activeRoleTab]}
              onPress={() => { setRole('teacher'); setError(''); }}
            >
              <BookOpen size={16} color={role === 'teacher' ? Colors.dark.primary : Colors.dark.textSecondary} style={{ marginRight: 4 }} />
              <Text style={[styles.roleTabText, role === 'teacher' && styles.activeRoleText]}>Teacher</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.roleTab, role === 'admin' && styles.activeRoleTab]}
              onPress={() => { setRole('admin'); setError(''); }}
            >
              <Lock size={16} color={role === 'admin' ? Colors.dark.primary : Colors.dark.textSecondary} style={{ marginRight: 4 }} />
              <Text style={[styles.roleTabText, role === 'admin' && styles.activeRoleText]}>Admin</Text>
            </TouchableOpacity>
          </View>

          {/* Card Surface */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {role === 'student' ? 'Student Sign In' : role === 'teacher' ? 'Teacher Console' : 'Administrator'}
            </Text>

            {role === 'admin' ? (
              <View style={styles.adminPlaceholder}>
                <Lock size={32} color={Colors.dark.textSecondary} style={{ marginBottom: 16 }} />
                <Text style={styles.adminPlaceholderTitle}>Desktop Required</Text>
                <Text style={styles.adminPlaceholderText}>
                  For security and operational reasons, the Askd administrative console is only available via the web platform.
                </Text>
              </View>
            ) : (
              <>
                {/* Inner Sub-Tabs */}
            <View style={styles.subTabContainer}>
              {role === 'student' ? (
                <>
                  <TouchableOpacity 
                    style={[styles.subTab, studentTab === 'email' && styles.activeSubTab]}
                    onPress={() => { setStudentTab('email'); setError(''); }}
                  >
                    <Mail size={13} color={studentTab === 'email' ? Colors.dark.primary : Colors.dark.textSecondary} />
                    <Text style={[styles.subTabText, studentTab === 'email' && styles.activeSubTabText]}>College Email</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.subTab, studentTab === 'roll' && styles.activeSubTab]}
                    onPress={() => { setStudentTab('roll'); setError(''); }}
                  >
                    <CreditCard size={13} color={studentTab === 'roll' ? Colors.dark.primary : Colors.dark.textSecondary} />
                    <Text style={[styles.subTabText, studentTab === 'roll' && styles.activeSubTabText]}>Roll Number</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity 
                    style={[styles.subTab, teacherTab === 'email' && styles.activeSubTab]}
                    onPress={() => { setTeacherTab('email'); setError(''); }}
                  >
                    <Mail size={13} color={teacherTab === 'email' ? Colors.dark.primary : Colors.dark.textSecondary} />
                    <Text style={[styles.subTabText, teacherTab === 'email' && styles.activeSubTabText]}>College Email</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.subTab, teacherTab === 'empId' && styles.activeSubTab]}
                    onPress={() => { setTeacherTab('empId'); setError(''); }}
                  >
                    <CreditCard size={13} color={teacherTab === 'empId' ? Colors.dark.primary : Colors.dark.textSecondary} />
                    <Text style={[styles.subTabText, teacherTab === 'empId' && styles.activeSubTabText]}>Employee ID</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Inputs */}
            {role === 'student' && studentTab === 'email' && (
              <View style={styles.inputWrapper}>
                <Text style={styles.label}>College Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 123me0019@iiitk.ac.in"
                  placeholderTextColor="#4A4745"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>
            )}

            {role === 'student' && studentTab === 'roll' && (
              <View style={styles.inputWrapper}>
                <Text style={styles.label}>Roll Number</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 124AD0020"
                  placeholderTextColor="#4A4745"
                  value={rollNumber}
                  onChangeText={setRollNumber}
                  autoCapitalize="characters"
                />
              </View>
            )}

            {role === 'teacher' && teacherTab === 'email' && (
              <View style={styles.inputWrapper}>
                <Text style={styles.label}>College Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. professor@iiitk.ac.in"
                  placeholderTextColor="#4A4745"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>
            )}

            {role === 'teacher' && teacherTab === 'empId' && (
              <View style={styles.inputWrapper}>
                <Text style={styles.label}>Employee ID</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. EMP4002"
                  placeholderTextColor="#4A4745"
                  value={employeeId}
                  onChangeText={setEmployeeId}
                  autoCapitalize="characters"
                />
              </View>
            )}

            {/* Password */}
            <View style={styles.inputWrapper}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Password</Text>
                <TouchableOpacity>
                  <Text style={styles.forgotBtn}>Forgot?</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.passwordInputContainer}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Enter your password"
                  placeholderTextColor="#4A4745"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity 
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}
                >
                  {showPassword ? (
                    <EyeOff size={18} color={Colors.dark.textSecondary} />
                  ) : (
                    <Eye size={18} color={Colors.dark.textSecondary} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Help Hint */}
            {role === 'student' && studentTab === 'roll' && (
              <View style={styles.hintBox}>
                <Text style={styles.hintText}>ℹ️ Need to reset? You can do so using your registered college email account.</Text>
              </View>
            )}

            {/* Error Message */}
            {error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : null}

                {/* Submit Button */}
                <TouchableOpacity 
                  style={[styles.submitButton, loading && styles.disabledButton]}
                  onPress={handleLogin}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color={Colors.dark.text} size="small" />
                  ) : (
                    <Text style={styles.submitButtonText}>Sign In</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Footer Navigation */}
          {role !== 'admin' && (
            <View style={styles.footer}>
              <Text style={styles.footerText}>New to Askd?</Text>
              <TouchableOpacity onPress={() => router.push({ pathname: '/(auth)/signup', params: { role } })}>
                <Text style={styles.signUpLink}> Create account</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.four,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: Spacing.five,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(235, 94, 40, 0.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(235, 94, 40, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  titleText: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  subtitleText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.one,
  },
  roleContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 4,
    marginBottom: Spacing.four,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  roleTab: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  activeRoleTab: {
    backgroundColor: Colors.dark.surfaceLight,
  },
  roleTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  activeRoleText: {
    color: Colors.dark.primary,
  },
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 24,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: Spacing.three,
    textAlign: 'center',
  },
  adminPlaceholder: {
    alignItems: 'center',
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.two,
  },
  adminPlaceholderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: Spacing.two,
  },
  adminPlaceholderText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  subTabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    marginBottom: Spacing.four,
  },
  subTab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  activeSubTab: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.dark.primary,
  },
  subTabText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.dark.textSecondary,
  },
  activeSubTabText: {
    color: Colors.dark.primary,
  },
  inputWrapper: {
    marginBottom: Spacing.three,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.one,
  },
  label: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginBottom: 6,
  },
  forgotBtn: {
    fontSize: 12,
    color: Colors.dark.primary,
  },
  input: {
    backgroundColor: Colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.dark.text,
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.dark.borderLight,
    borderRadius: 14,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.dark.text,
  },
  eyeBtn: {
    paddingHorizontal: 14,
  },
  hintBox: {
    backgroundColor: Colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 12,
    padding: 12,
    marginVertical: Spacing.two,
  },
  hintText: {
    fontSize: 11.5,
    color: Colors.dark.textSecondary,
    lineHeight: 16,
  },
  errorText: {
    fontSize: 12,
    color: Colors.dark.error,
    marginBottom: Spacing.three,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  disabledButton: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.five,
  },
  footerText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
  signUpLink: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.primary,
  },
});
