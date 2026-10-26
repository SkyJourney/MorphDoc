import { useEffect, useState } from "react";
import {
  getThemeCss,
  listThemes,
  type ThemeSummary
} from "./application-backend";

export type { ThemeSummary } from "./application-backend";

export function useThemeResources(
  themeId: string,
  onThemesLoaded: (
    themes: ThemeSummary[],
    refreshKey: number
  ) => void,
  refreshKey = 0
) {
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [themeCss, setThemeCss] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [cssError, setCssError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    void listThemes(controller.signal)
      .then(({ themes: availableThemes }) => {
        setThemes(availableThemes);
        setCatalogError("");
        onThemesLoaded(availableThemes, refreshKey);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setCatalogError(
            reason instanceof Error ? reason.message : "无法加载主题清单"
          );
        }
      });

    return () => controller.abort();
  }, [onThemesLoaded, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setThemeCss("");
    setCssError("");

    void getThemeCss(themeId, controller.signal)
      .then(setThemeCss)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setCssError(
            reason instanceof Error ? reason.message : "无法加载主题"
          );
        }
      });

    return () => controller.abort();
  }, [refreshKey, themeId]);

  return {
    error: catalogError || cssError,
    themeCss,
    themes
  };
}
