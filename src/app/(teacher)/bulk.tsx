import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import GlobalHeader from '../../components/GlobalHeader';
import { Colors, Spacing, Fonts } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { FileDown, ChevronRight, Copy, Download } from 'lucide-react-native';
import * as XLSX from 'xlsx';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Buffer } from 'buffer';

type Exam = { id: string; title: string; subject: string; total_marks: number; };

type ReportRow = {
  roll_number: string;
  name: string;
  total_awarded: number | null;
  status: string;
};

export default function TeacherBulkScreen() {
  const { user } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [reportData, setReportData] = useState<ReportRow[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);

  const fetchExams = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('exams')
        .select('id, title, subject, total_marks')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setExams(data as Exam[]);
    } catch (err) {
      console.error('Error fetching exams:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchReport = async (exam: Exam) => {
    setLoadingReport(true);
    try {
      const { data, error } = await supabase
        .from('answer_scripts')
        .select(`
          status, total_awarded, roll_number,
          student:profiles!answer_scripts_student_id_fkey(full_name, roll_number)
        `)
        .eq('exam_id', exam.id);

      if (error) throw error;

      const formatted: ReportRow[] = data.map((d: any) => ({
        roll_number: d.student?.roll_number || d.roll_number || 'UNKNOWN',
        name: d.student?.full_name || 'N/A',
        total_awarded: d.total_awarded,
        status: d.status
      }));

      // Sort by roll number
      formatted.sort((a, b) => a.roll_number.localeCompare(b.roll_number));
      setReportData(formatted);
    } catch (err) {
      console.error('Error fetching report:', err);
    } finally {
      setLoadingReport(false);
    }
  };

  useEffect(() => {
    fetchExams();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    if (!selectedExam) {
      fetchExams();
    } else {
      fetchReport(selectedExam);
      setRefreshing(false);
    }
  };

  const exportToExcel = async () => {
    if (reportData.length === 0 || !selectedExam) return;

    try {
      const rows = reportData.map(r => ({
        "Roll Number": r.roll_number,
        "Name": r.name,
        "Total Awarded": r.total_awarded ?? '-',
        "Status": r.status
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Results");

      const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const filename = `${selectedExam.title.replace(/\s+/g, '_')}_Report.xlsx`;
      const file = new File(Paths.cache, filename);
      file.create();
      const binaryData = Buffer.from(wbout, 'base64');
      file.write(binaryData);
      const uri = file.uri;

      Alert.alert(
        'Excel Report Ready',
        `Excel sheet "${filename}" generated successfully.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Download / Share', 
            onPress: () => Sharing.shareAsync(uri, {
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              dialogTitle: 'Download Excel Report',
              UTI: 'org.openxmlformats.spreadsheetml.sheet'
            })
          }
        ]
      );
    } catch (err) {
      console.error('Error exporting Excel:', err);
      Alert.alert('Export Failed', 'An error occurred while generating the Excel file.');
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
      {!selectedExam ? (
        <>
          <GlobalHeader role="teacher" title="Batch Reports" />
          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />}
          >
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Batch Reports</Text>
              <Text style={styles.subText}>Generate and export evaluation data</Text>
            </View>

            <View>
              <Text style={styles.sectionTitle}>Select an Exam to Export</Text>
              {exams.length > 0 ? (
                <View style={styles.listContainer}>
                  {exams.map(e => (
                    <TouchableOpacity 
                      key={e.id} 
                      style={styles.card}
                      onPress={() => {
                        setSelectedExam(e);
                        fetchReport(e);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.examTitle}>{e.title}</Text>
                        <Text style={styles.examSub}>{e.subject} • {e.total_marks} Marks</Text>
                      </View>
                      <ChevronRight size={18} color={Colors.dark.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <FileDown size={32} color={Colors.dark.textSecondary} />
                  <Text style={styles.emptyText}>No exams available to export.</Text>
                </View>
              )}
            </View>
          </ScrollView>
        </>
      ) : (
        <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: Colors.dark.background }}>
          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.primary} />}
          >
            <TouchableOpacity style={styles.backBtn} onPress={() => setSelectedExam(null)}>
              <Text style={styles.backBtnText}>← Back to Exams</Text>
            </TouchableOpacity>

            <View style={styles.reportHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle}>{selectedExam.title} Report</Text>
                <Text style={styles.reportSub}>Total Scripts: {reportData.length}</Text>
              </View>
              <TouchableOpacity style={styles.downloadBtn} onPress={exportToExcel}>
                <Download size={16} color="#fff" />
                <Text style={styles.downloadBtnText}>Download Excel</Text>
              </TouchableOpacity>
            </View>

            {loadingReport ? (
              <ActivityIndicator size="small" color={Colors.dark.primary} style={{ marginTop: 20 }} />
            ) : reportData.length > 0 ? (
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, { flex: 2 }]}>Student</Text>
                  <Text style={[styles.th, { flex: 1, textAlign: 'center' }]}>Score</Text>
                  <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Status</Text>
                </View>
                {reportData.map((row, i) => (
                  <View key={i} style={[styles.tr, i === reportData.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={{ flex: 2 }}>
                      <Text style={styles.tdRoll}>{row.roll_number}</Text>
                      <Text style={styles.tdName} numberOfLines={1}>{row.name}</Text>
                    </View>
                    <Text style={[styles.tdScore, { flex: 1, textAlign: 'center' }]}>{row.total_awarded ?? '-'}</Text>
                    <Text style={[styles.tdStatus, { flex: 1, textAlign: 'right' }, row.status === 'evaluated' && { color: Colors.dark.success }]}>{row.status}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <FileDown size={32} color={Colors.dark.textSecondary} />
                <Text style={styles.emptyText}>No scripts found for this exam.</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      )}
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
  examTitle: { fontSize: 15, fontWeight: '600', color: Colors.dark.text, marginBottom: 4 },
  examSub: { fontSize: 12, color: Colors.dark.textSecondary },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six, gap: 12 },
  emptyText: { fontSize: 13, color: Colors.dark.textSecondary },
  backBtn: { marginBottom: Spacing.three, alignSelf: 'flex-start' },
  backBtnText: { fontSize: 12, color: Colors.dark.primary, fontWeight: '600' },
  reportHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.dark.surfaceLight, padding: 16, borderRadius: 12, marginBottom: Spacing.four },
  reportTitle: { fontSize: 16, fontWeight: '700', color: Colors.dark.text, marginBottom: 2 },
  reportSub: { fontSize: 11, color: Colors.dark.textSecondary },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.dark.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, gap: 6 },
  downloadBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  table: { backgroundColor: Colors.dark.surface, borderWidth: 1, borderColor: Colors.dark.border, borderRadius: 12, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: Colors.dark.surfaceLight, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.dark.border },
  th: { fontSize: 10, fontWeight: '700', color: Colors.dark.textSecondary, textTransform: 'uppercase' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.dark.border },
  tdRoll: { fontSize: 11, fontFamily: Fonts.mono, color: Colors.dark.text, fontWeight: '600' },
  tdName: { fontSize: 10, color: Colors.dark.textSecondary, marginTop: 2 },
  tdScore: { fontSize: 13, fontFamily: Fonts.mono, color: Colors.dark.text, fontWeight: '700' },
  tdStatus: { fontSize: 10, color: Colors.dark.textSecondary, textTransform: 'capitalize', fontWeight: '500' }
});
