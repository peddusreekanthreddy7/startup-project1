import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { ActivityIndicator, View } from 'react-native';
import { Colors } from '../constants/theme';
import { StatusBar } from 'expo-status-bar';

function NavigationGate() {
  const { session, profile, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inStudentGroup = segments[0] === '(student)';
    const inTeacherGroup = segments[0] === '(teacher)';

    if (!session) {
      // If not logged in, redirect to login screen
      if (!inAuthGroup) {
        router.replace('/(auth)/login');
      }
    } else {
      // If logged in, check role
      if (profile) {
        if (profile.role === 'student') {
          if (!inStudentGroup) {
            router.replace('/(student)/dashboard');
          }
        } else if (profile.role === 'teacher') {
          if (!inTeacherGroup) {
            router.replace('/(teacher)/dashboard');
          }
        } else {
          // If admin, show alert or fallback
          if (!inAuthGroup) {
            router.replace('/(auth)/login');
          }
        }
      }
    }
  }, [session, profile, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background }}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Slot />
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <NavigationGate />
    </AuthProvider>
  );
}
