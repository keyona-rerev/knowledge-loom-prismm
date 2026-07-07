import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// The account's saved posting timezone (Settings > Posting defaults). Used
// wherever a reschedule needs a timezone to send to the publisher, in place
// of guessing from the browser. Returns null until loaded or if the user
// has never set one, so callers fall back to the browser guess exactly as
// before -- this only takes over once someone has actually saved a default.
export const useDefaultTimezone = () => {
  const [timezone, setTimezone] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase
        .from("profiles")
        .select("default_timezone")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (data?.default_timezone) setTimezone(data.default_timezone);
    };
    load();
  }, []);

  return timezone;
};
