import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useUserColors = () => {
  const [colors, setColors] = useState({
    primary: "#9b87f5",
    secondary: "#7E69AB",
    accent: "#6E59A5"
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUserColors = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("primary_color, secondary_color, accent_color")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (data) {
        setColors({
          primary: data.primary_color || "#9b87f5",
          secondary: data.secondary_color || "#7E69AB",
          accent: data.accent_color || "#6E59A5"
        });
      }
      setLoading(false);
    };

    loadUserColors();

    // Listen for changes to profile
    const channel = supabase
      .channel('profile-colors')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles'
        },
        (payload) => {
          if (payload.new.primary_color) {
            setColors({
              primary: payload.new.primary_color,
              secondary: payload.new.secondary_color,
              accent: payload.new.accent_color
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { colors, loading };
};
