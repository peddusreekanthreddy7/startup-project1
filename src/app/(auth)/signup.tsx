import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing } from '../../constants/theme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Mail, User, Eye, EyeOff, Award, BookOpen, ShieldAlert } from 'lucide-react-native';

type Role = 'student' | 'teacher';

export default function SignupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const initialRole = (params.role as Role) || 'student';

  const [role, setRole] = useState<Role>(initialRole);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Student specific fields
  const [rollNumber, setRollNumber] = useState('');
  const [branch, setBranch] = useState('');
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');

  // Teacher specific fields
  const [employeeId, setEmployeeId] = useState('');
  const [department, setDepartment] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSignup = async () => {
    setError('');
    setSuccess(false);
    setLoading(true);

    try {
      if (!fullName) throw new Error('Please enter your full name.');
      if (!email) throw new Error('Please enter your email.');
      if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');

      const metadata: Record<string, any> = {
        role,
        full_name: fullName,
      };

      if (role === 'student') {
        if (!rollNumber) throw new Error('Please enter your roll number.');
        if (!branch) throw new Error('Please enter your branch.');
        metadata.roll_number = rollNumber.trim().toUpperCase();
        metadata.branch = branch.trim();
        metadata.start_year = startYear ? parseInt(startYear) : null;
        metadata.end_year = endYear ? parseInt(endYear) : null;
      } else {
        if (!employeeId) throw new Error('Please enter your employee ID.');
        if (!department) throw new Error('Please enter your department.');
        metadata.employee_id = employeeId.trim().toUpperCase();
        metadata.department = department.trim();
      }

      // Supabase Signup
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          data: metadata,
        },
      });

      if (signUpErr) throw signUpErr;

      // Auto-link student orphan evaluations if a student signs up
      if (role === 'student' && data.user) {
        try {
          // This matches the background linking done in web auth actions
          await supabase
            .from('answer_scripts')
            .update({ student_id: data.user.id })
            .eq('roll_number', rollNumber.trim().toUpperCase())
            .is('student_id', null);
        } catch (linkErr) {
          // Fail silently, don't block signup completion
          console.warn('Orphan script linking failed:', linkErr);
        }
      }

      setSuccess(true);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'An error occurred during sign up.');
      setLoading(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successContainer}>
          <View style={styles.logoBadge}>
            <Award size={48} color={Colors.dark.primary} />
          </View>
          <Text style={styles.titleText}>Registration Successful!</Text>
          <Text style={styles.subtitleText}>
            Your {role} account has been created. If email verification is enabled, please check your inbox.
          </Text>
          <TouchableOpacity 
            style={styles.submitButton}
            onPress={() => router.replace('/(auth)/login')}
          >
            <Text style={styles.submitButtonText}>Go to Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          
          {/* Header */}
          <View style={styles.headerContainer}>
            <Text style={styles.titleText}>Create Account</Text>
            <Text style={styles.subtitleText}>Join the academic evolution</Text>
          </View>

          {/* Role selector */}
          <View style={styles.roleContainer}>
            <TouchableOpacity 
              style={[styles.roleTab, role === 'student' && styles.activeRoleTab]}
              onPress={() => { setRole('student'); setError(''); }}
            >
              <User size={16} color={role === 'student' ? Colors.dark.primary : Colors.dark.textSecondary} style={{ marginRight: 6 }} />
              <Text style={[styles.roleTabText, role === 'student' && styles.activeRoleText]}>Student</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.roleTab, role === 'teacher' && styles.activeRoleTab]}
              onPress={() => { setRole('teacher'); setError(''); }}
            >
              <BookOpen size={16} color={role === 'teacher' ? Colors.dark.primary : Colors.dark.textSecondary} style={{ marginRight: 6 }} />
              <Text style={[styles.roleTabText, role === 'teacher' && styles.activeRoleText]}>Teacher</Text>
            </TouchableOpacity>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Full Name */}
            <View style={styles.inputWrapper}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter full name"
                placeholderTextColor="#4A4745"
                value={fullName}
                onChangeText={setFullName}
              />
            </View>

            {/* Email */}
            <View style={styles.inputWrapper}>
              <Text style={styles.label}>College Email</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. name@iiitk.ac.in"
                placeholderTextColor="#4A4745"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            {/* Student Specific Fields */}
            {role === 'student' && (
              <>
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
                
                <View style={styles.inputWrapper}>
                  <Text style={styles.label}>Branch / Major</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Computer Science"
                    placeholderTextColor="#4A4745"
                    value={branch}
                    onChangeText={setBranch}
                  />
                </View>

                <View style={styles.row}>
                  <View style={[styles.inputWrapper, { flex: 1, marginRight: 8 }]}>
                    <Text style={styles.label}>Start Year</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 2023"
                      placeholderTextColor="#4A4745"
                      value={startYear}
                      onChangeText={setStartYear}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={[styles.inputWrapper, { flex: 1, marginLeft: 8 }]}>
                    <Text style={styles.label}>End Year</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 2027"
                      placeholderTextColor="#4A4745"
                      value={endYear}
                      onChangeText={setEndYear}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              </>
            )}

            {/* Teacher Specific Fields */}
            {role === 'teacher' && (
              <>
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
                
                <View style={styles.inputWrapper}>
                  <Text style={styles.label}>Department</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Mathematics"
                    placeholderTextColor="#4A4745"
                    value={department}
                    onChangeText={setDepartment}
                  />
                </View>
              </>
            )}

            {/* Password */}
            <View style={styles.inputWrapper}>
              <Text style={styles.label}>Password (Min 6 chars)</Text>
              <View style={styles.passwordInputContainer}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Create password"
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

            {/* Error Message */}
            {error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : null}

            {/* Submit Button */}
            <TouchableOpacity 
              style={[styles.submitButton, loading && styles.disabledButton]}
              onPress={handleSignup}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={Colors.dark.text} size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Create Account</Text>
              )}
            </TouchableOpacity>

          </View>

          {/* Footer Navigation */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
              <Text style={styles.signUpLink}> Sign In</Text>
            </TouchableOpacity>
          </View>

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
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: Spacing.four,
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
    textAlign: 'center',
    lineHeight: 20,
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
  inputWrapper: {
    marginBottom: Spacing.three,
  },
  label: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginBottom: 6,
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
  row: {
    flexDirection: 'row',
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
    width: '100%',
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
  logoBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(235, 94, 40, 0.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(235, 94, 40, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.four,
  },
});
