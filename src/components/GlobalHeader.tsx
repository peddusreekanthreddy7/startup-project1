import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Dimensions,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { isRunningInExpoGo } from 'expo';
import { useRouter, usePathname } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Colors } from '../constants/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Menu,
  Bell,
  X,
  LogOut,
  Mail,
  Hash,
  BookOpen,
  User,
  Settings,
  AlertCircle,
  CheckCircle,
  Home,
  FileText,
  UserCheck,
  BarChart2,
  Scale,
  Bot,
  ChevronRight
} from 'lucide-react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: NotificationsModule | null | undefined;

async function getNotificationsModule() {
  if (Platform.OS === 'android' && isRunningInExpoGo()) {
    notificationsModule = null;
    return null;
  }

  if (notificationsModule !== undefined) {
    return notificationsModule;
  }

  try {
    notificationsModule = await import('expo-notifications');
    notificationsModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
    return notificationsModule;
  } catch (err) {
    console.warn('Notifications unavailable in this runtime:', err);
    notificationsModule = null;
    return null;
  }
}

type NotificationItem = {
  id: string;
  type: 'evaluation' | 'objection' | 'approval';
  title: string;
  detail: string;
  time: string;
};

interface GlobalHeaderProps {
  title?: string;
  role: 'student' | 'teacher';
}

export default function GlobalHeader({ title, role }: GlobalHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const showTitle = windowWidth >= 768;
  
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const slideAnim = useRef(new Animated.Value(-SCREEN_WIDTH * 0.75)).current;

  // Initialize notifications & permissions
  useEffect(() => {
    const requestPermissions = async () => {
      const Notifications = await getNotificationsModule();
      if (!Notifications) return;

      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        console.log('Notification permission not granted');
      }
    };
    requestPermissions();
    fetchNotifications();

    // Set up polling for new notifications every 15 seconds
    const interval = setInterval(() => {
      fetchNotifications();
    }, 15000);

    return () => clearInterval(interval);
  }, [profile]);

  // Handle drawer animation
  useEffect(() => {
    if (drawerOpen) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -SCREEN_WIDTH * 0.75,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [drawerOpen]);

  const initials = (name?: string) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const fetchNotifications = async () => {
    if (!profile) return;
    try {
      const notifs: NotificationItem[] = [];

      if (profile.role === 'student') {
        // Fetch student evaluations
        const { data: recentEvals } = await supabase
          .from('answer_scripts')
          .select('id, total_awarded, evaluated_at, exam:exams!exam_id(title, total_marks)')
          .eq('student_id', profile.id)
          .eq('status', 'evaluated')
          .order('evaluated_at', { ascending: false })
          .limit(5);

        for (const ev of recentEvals ?? []) {
          const exam = ev.exam as any;
          notifs.push({
            id: `eval-${ev.id}`,
            type: 'evaluation',
            title: `${exam?.title ?? 'Exam'} Graded`,
            detail: `Score: ${ev.total_awarded}/${exam?.total_marks ?? '?'}`,
            time: ev.evaluated_at
              ? new Date(ev.evaluated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              : '',
          });
        }

        // Fetch student objections
        const { data: recentObjections } = await supabase
          .from('paper_objections')
          .select('id, status, raised_at, script:answer_scripts!script_id(exam:exams!exam_id(title))')
          .eq('student_id', profile.id)
          .order('raised_at', { ascending: false })
          .limit(5);

        for (const obj of recentObjections ?? []) {
          const exam = obj.script as any;
          const statusText =
            obj.status === 'sent'
              ? 'Submitted'
              : obj.status === 'review'
              ? 'Under Review'
              : obj.status === 'resolved'
              ? 'Resolved'
              : 'Marks Updated';
          notifs.push({
            id: `obj-${obj.id}-${obj.status}`,
            type: 'objection',
            title: `Dispute: ${statusText}`,
            detail: exam?.exam?.title ?? 'Exam Paper',
            time: new Date(obj.raised_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          });
        }
      } else if (profile.role === 'teacher') {
        // Fetch teacher's exams objections
        const { data: exams } = await supabase
          .from('exams')
          .select('id')
          .eq('created_by', profile.id);

        if (exams && exams.length > 0) {
          const examIds = exams.map((e) => e.id);
          const { data: scripts } = await supabase
            .from('answer_scripts')
            .select('id')
            .in('exam_id', examIds);

          if (scripts && scripts.length > 0) {
            const scriptIds = scripts.map((s) => s.id);
            const { data: recentObjections } = await supabase
              .from('paper_objections')
              .select('id, text, status, raised_at, student:profiles!student_id(full_name)')
              .in('script_id', scriptIds)
              .in('status', ['sent', 'review'])
              .order('raised_at', { ascending: false })
              .limit(5);

            for (const obj of recentObjections ?? []) {
              const studentName = Array.isArray(obj.student)
                ? (obj.student[0]?.full_name ?? 'Student')
                : ((obj.student as any)?.full_name ?? 'Student');
              notifs.push({
                id: `obj-${obj.id}-${obj.status}`,
                type: 'objection',
                title: `Objection from ${studentName}`,
                detail: obj.text.slice(0, 50) + (obj.text.length > 50 ? '...' : ''),
                time: new Date(obj.raised_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
              });
            }
          }
        }

        // Fetch teacher's student approvals
        const { count: pendingApprovals } = await supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'student')
          .eq('is_approved', false);

        if (pendingApprovals && pendingApprovals > 0) {
          notifs.push({
            id: 'approvals-pending',
            type: 'approval',
            title: 'Pending Student Approvals',
            detail: `You have ${pendingApprovals} student registration(s) pending review`,
            time: 'Now',
          });
        }
      }

      // Check for new notifications to trigger local/push alert
      const storedNotifiedRaw = await AsyncStorage.getItem('notified_ids');
      const notifiedIds = storedNotifiedRaw ? JSON.parse(storedNotifiedRaw) : [];
      let hasNew = false;
      const newIds = [...notifiedIds];

      for (const n of notifs) {
        if (!notifiedIds.includes(n.id)) {
          hasNew = true;
          newIds.push(n.id);

          const Notifications = await getNotificationsModule();
          if (Notifications) {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: n.title,
                body: n.detail,
                sound: true,
                priority: Notifications.AndroidNotificationPriority.HIGH,
              },
              trigger: null,
            });
          }
        }
      }

      if (hasNew) {
        await AsyncStorage.setItem('notified_ids', JSON.stringify(newIds));
      }

      // Save unread count and notifications list
      const lastReadRaw = await AsyncStorage.getItem('last_read_notifications');
      const lastRead = lastReadRaw ? JSON.parse(lastReadRaw) : [];
      const unread = notifs.filter((n) => !lastRead.includes(n.id)).length;
      
      setNotifications(notifs);
      setUnreadCount(unread);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  };

  const markNotificationsAsRead = async () => {
    const ids = notifications.map((n) => n.id);
    await AsyncStorage.setItem('last_read_notifications', JSON.stringify(ids));
    setUnreadCount(0);
  };

  const handleNav = (screen: string) => {
    setDrawerOpen(false);
    router.push(screen as any);
  };

  const handleLogout = async () => {
    setDrawerOpen(false);
    await signOut();
    router.replace('/');
  };

  // Nav Items depending on Role
  const studentNav = [
    { label: 'Dashboard', icon: <Home size={20} color={Colors.dark.text} />, path: '/(student)/dashboard' },
    { label: 'My Courses', icon: <BookOpen size={20} color={Colors.dark.text} />, path: '/(student)/courses' },
    { label: 'Answer Scripts', icon: <FileText size={20} color={Colors.dark.text} />, path: '/(student)/scripts' },
    { label: 'Disputes', icon: <Scale size={20} color={Colors.dark.text} />, path: '/(student)/disputes' },
  ];

  const teacherNav = [
    { label: 'Dashboard', icon: <Home size={20} color={Colors.dark.text} />, path: '/(teacher)/dashboard' },
    { label: 'Answer Scripts', icon: <FileText size={20} color={Colors.dark.text} />, path: '/(teacher)/scripts' },
    { label: 'AI Evaluation', icon: <Bot size={20} color={Colors.dark.text} />, path: '/(teacher)/evaluation' },
    { label: 'Student Approvals', icon: <UserCheck size={20} color={Colors.dark.text} />, path: '/(teacher)/approvals' },
    { label: 'Batch Marks Export', icon: <BarChart2 size={20} color={Colors.dark.text} />, path: '/(teacher)/bulk' },
  ];

  const navItems = role === 'student' ? studentNav : teacherNav;

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.headerContainer}>
        {/* Left Side: Hamburger */}
        <TouchableOpacity style={styles.iconBtn} onPress={() => setDrawerOpen(true)}>
          <Menu size={22} color={Colors.dark.text} />
        </TouchableOpacity>

        {/* Center: Title / Custom logo */}
        {showTitle ? (
          <View style={styles.titleContainer}>
            <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Askd'}</Text>
          </View>
        ) : (
          <View style={styles.titleSpacer} />
        )}

        {/* Right Side: Notification and Profile */}
        <View style={styles.rightActions}>
          {/* Notification Bell */}
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => {
              setNotificationsOpen(true);
              markNotificationsAsRead();
            }}
          >
            <Bell size={20} color={Colors.dark.text} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Profile Initials Button */}
          <TouchableOpacity style={styles.avatarBtn} onPress={() => setProfileOpen(true)}>
            <Text style={styles.avatarText}>{initials(profile?.full_name)}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 1. SIDE DRAWER MODAL */}
      <Modal visible={drawerOpen} transparent={true} animationType="none" onRequestClose={() => setDrawerOpen(false)}>
        <View style={styles.drawerOverlay}>
          <Animated.View style={[styles.drawerContainer, { transform: [{ translateX: slideAnim }] }]}>
            <SafeAreaView style={{ flex: 1 }}>
              {/* Drawer Header Profile info */}
              <View style={styles.drawerHeader}>
                <View style={styles.drawerAvatar}>
                  <Text style={styles.drawerAvatarText}>{initials(profile?.full_name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.drawerName} numberOfLines={1}>{profile?.full_name || 'User'}</Text>
                  <Text style={styles.drawerRole} numberOfLines={1}>
                    {role === 'student' ? `Roll No: ${profile?.roll_number || 'Student'}` : 'Instructor'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setDrawerOpen(false)}>
                  <X size={20} color={Colors.dark.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Navigation list */}
              <ScrollView style={styles.drawerScroll}>
                <View style={{ paddingVertical: 12 }}>
                  {navItems.map((item) => {
                    const isActive = pathname === item.path;
                    return (
                      <TouchableOpacity
                        key={item.label}
                        style={[styles.drawerNavItem, isActive && styles.activeItem]}
                        onPress={() => handleNav(item.path)}
                      >
                        <View style={{ marginRight: 12 }}>{item.icon}</View>
                        <Text style={[styles.navText, isActive && styles.activeNavText]}>{item.label}</Text>
                        <ChevronRight size={14} color={Colors.dark.textSecondary} style={{ marginLeft: 'auto' }} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Drawer Footer: Settings & Sign Out */}
              <View style={styles.drawerFooter}>
                <TouchableOpacity style={[styles.footerBtn, styles.logoutBtn]} onPress={handleLogout}>
                  <LogOut size={18} color="#ef4444" />
                  <Text style={[styles.footerBtnText, { color: '#ef4444' }]}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </Animated.View>

          {/* Transparent clickable dismiss area */}
          <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={() => setDrawerOpen(false)} />
        </View>
      </Modal>

      {/* 2. NOTIFICATIONS MODAL */}
      <Modal visible={notificationsOpen} transparent={true} animationType="fade" onRequestClose={() => setNotificationsOpen(false)}>
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogCard}>
            <View style={styles.dialogHeader}>
              <Text style={styles.dialogTitle}>Notifications</Text>
              <TouchableOpacity onPress={() => setNotificationsOpen(false)}>
                <X size={18} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.5 }}>
              {notifications.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Bell size={24} color={Colors.dark.textSecondary} />
                  <Text style={styles.emptyText}>No notifications yet.</Text>
                </View>
              ) : (
                notifications.map((n) => (
                  <View key={n.id} style={styles.notificationItem}>
                    <View style={styles.notificationIconWrapper}>
                      {n.type === 'evaluation' ? (
                        <CheckCircle size={16} color={Colors.dark.success} />
                      ) : (
                        <AlertCircle size={16} color={Colors.dark.primary} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.notifTitle}>{n.title}</Text>
                      <Text style={styles.notifDetail}>{n.detail}</Text>
                      <Text style={styles.notifTime}>{n.time}</Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 3. PROFILE & SETTINGS MODAL */}
      <Modal visible={profileOpen} transparent={true} animationType="fade" onRequestClose={() => setProfileOpen(false)}>
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogCard}>
            <View style={styles.dialogHeader}>
              <Text style={styles.dialogTitle}>Profile & Settings</Text>
              <TouchableOpacity onPress={() => setProfileOpen(false)}>
                <X size={18} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ padding: 16 }}>
              {/* Profile Card */}
              <View style={styles.profileSummary}>
                <View style={styles.profileAvatarLarge}>
                  <Text style={styles.profileAvatarTextLarge}>{initials(profile?.full_name)}</Text>
                </View>
                <Text style={styles.profileNameText}>{profile?.full_name || 'Loading...'}</Text>
                <Text style={styles.profileRoleText}>{role.toUpperCase()}</Text>
              </View>

              {/* Profile Details List */}
              <View style={styles.detailsList}>
                <View style={styles.detailRow}>
                  <Mail size={16} color={Colors.dark.textSecondary} />
                  <Text style={styles.detailLabel}>Email</Text>
                  <Text style={styles.detailValue} numberOfLines={1}>{profile?.email}</Text>
                </View>

                {role === 'student' ? (
                  <>
                    <View style={styles.detailRow}>
                      <Hash size={16} color={Colors.dark.textSecondary} />
                      <Text style={styles.detailLabel}>Roll No</Text>
                      <Text style={styles.detailValue}>{profile?.roll_number || '—'}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <BookOpen size={16} color={Colors.dark.textSecondary} />
                      <Text style={styles.detailLabel}>Branch</Text>
                      <Text style={styles.detailValue}>{profile?.branch || '—'}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <User size={16} color={Colors.dark.textSecondary} />
                      <Text style={styles.detailLabel}>Year</Text>
                      <Text style={styles.detailValue}>{profile?.year || '—'}</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.detailRow}>
                      <Hash size={16} color={Colors.dark.textSecondary} />
                      <Text style={styles.detailLabel}>Employee ID</Text>
                      <Text style={styles.detailValue}>{profile?.employee_id || '—'}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <BookOpen size={16} color={Colors.dark.textSecondary} />
                      <Text style={styles.detailLabel}>Department</Text>
                      <Text style={styles.detailValue}>{profile?.department || '—'}</Text>
                    </View>
                  </>
                )}
              </View>

              {/* Simple Settings Section */}
              <View style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: Colors.dark.border, paddingTop: 16 }}>
                <Text style={styles.sectionTitle}>App Preferences</Text>
                
                <View style={[styles.detailRow, { borderBottomWidth: 0, paddingVertical: 12 }]}>
                  <Settings size={16} color={Colors.dark.textSecondary} />
                  <Text style={styles.detailLabel}>Theme</Text>
                  <Text style={styles.detailValue}>Dark (Harmonious)</Text>
                </View>
                
                <View style={[styles.detailRow, { borderBottomWidth: 0, paddingVertical: 12 }]}>
                  <AlertCircle size={16} color={Colors.dark.textSecondary} />
                  <Text style={styles.detailLabel}>Version</Text>
                  <Text style={styles.detailValue}>1.0.0</Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: Colors.dark.surface,
  },
  headerContainer: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: Colors.dark.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  titleSpacer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: Colors.dark.primary,
    borderRadius: 8,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  avatarBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  avatarText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  /* DRAWER MODAL STYLES */
  drawerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 10, 10, 0.82)',
    flexDirection: 'row',
  },
  dismissArea: {
    flex: 1,
  },
  drawerContainer: {
    width: Math.min(SCREEN_WIDTH * 0.82, 320),
    height: '100%',
    backgroundColor: Colors.dark.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.dark.border,
    paddingTop: 10,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    gap: 12,
  },
  drawerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  drawerAvatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  drawerName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  drawerRole: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  drawerScroll: {
    flex: 1,
  },
  drawerNavItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: 8,
    marginVertical: 2,
    borderRadius: 8,
  },
  activeItem: {
    backgroundColor: 'rgba(235, 94, 40, 0.08)',
    borderLeftWidth: 3,
    borderLeftColor: Colors.dark.primary,
  },
  navText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.dark.text,
  },
  activeNavText: {
    color: Colors.dark.primary,
    fontWeight: '600',
  },
  drawerFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    gap: 12,
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  logoutBtn: {
    marginTop: 4,
  },
  footerBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.dark.textSecondary,
  },
  /* DIALOGS (NOTIFICATIONS, PROFILE) */
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 10, 10, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialogCard: {
    width: '100%',
    maxWidth: SCREEN_WIDTH - 40,
    backgroundColor: Colors.dark.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  dialogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    backgroundColor: Colors.dark.surfaceLight,
  },
  dialogTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
  notificationItem: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
    gap: 14,
    backgroundColor: Colors.dark.surface,
  },
  notificationIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(235, 94, 40, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  notifTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  notifDetail: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  notifTime: {
    fontSize: 10,
    color: Colors.dark.textSecondary,
    opacity: 0.7,
    marginTop: 4,
  },
  /* PROFILE MODAL DETAIL STYLES */
  profileSummary: {
    alignItems: 'center',
    marginBottom: 20,
  },
  profileAvatarLarge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  profileAvatarTextLarge: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  profileNameText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  profileRoleText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.dark.primary,
    marginTop: 4,
    letterSpacing: 1,
  },
  detailsList: {
    backgroundColor: Colors.dark.surfaceLight,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  detailLabel: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginLeft: 10,
    width: 90,
  },
  detailValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: Colors.dark.text,
    textAlign: 'right',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
