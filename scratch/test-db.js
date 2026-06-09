const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://aqihcfuuimerrosdsmmz.supabase.co';
const supabaseAnonKey = '***REDACTED_SUPABASE_ANON_KEY***';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  try {
    // Since we don't have direct SQL client, let's login a teacher and try to fetch enrollments.
    // Let's find a teacher email or try to query offering and enrollments with anon key.
    // Wait, let's see if we can find some profiles first. Can we select profiles?
    const { data: profs, error: pErr } = await supabase.from('profiles').select('id, email, role');
    console.log('Profiles (anon):', profs, pErr);

    // Let's query enrollments
    const { data: enr, error: eErr } = await supabase.from('enrollments').select('*');
    console.log('Enrollments (anon):', enr, eErr);
  } catch (err) {
    console.error(err);
  }
}

run();
