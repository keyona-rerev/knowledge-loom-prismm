import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// The account's saved business name (Strategy > Brand), for UI copy that
// otherwise has no reason to know or care about a specific business. Falls
// back to "the company" for anyone who hasn't set one, so copy still reads
// naturally instead of showing an empty name.
export const useBusinessName = () => {
  const [businessName, setBusinessName] = useState("the company");

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase
        .from("profiles")
        .select("business_name")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (data?.business_name) setBusinessName(data.business_name);
    };
    load();
  }, []);

  return businessName;
};
