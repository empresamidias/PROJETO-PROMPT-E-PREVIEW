
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wnwlmtnfvasxtcycydxm.supabase.co';
// User provided service role token
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indud2xtdG5mdmFzeHRjeWN5ZHhtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzE1MjY5MywiZXhwIjoyMDgyNzI4NjkzfQ.2umg5CRFpA4hDCQVZWVE0tVCghu7uapqhDU-ZiNS9QE';

export const supabase = createClient(supabaseUrl, supabaseKey);
