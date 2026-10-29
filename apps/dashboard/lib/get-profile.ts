
import { supabase } from "@/lib/supabase";

export async function getCurrentProfile() {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user || !user.email) {
    return { user: null, profile: null, error: "Not authenticated" };
  }

  if (!user.email.toLowerCase().endsWith("@iiitdwd.ac.in")) {
    await supabase.auth.signOut();
    return { user: null, profile: null, error: "Unapproved email domain" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, student_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return {
      user,
      profile: null,
      error: "No linked AntiProxy profile",
    };
  }

  return { user, profile, error: null };
}
