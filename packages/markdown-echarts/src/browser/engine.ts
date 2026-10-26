import * as echarts from "echarts/core";
import {
  BarChart,
  BoxplotChart,
  CandlestickChart,
  ChordChart,
  FunnelChart,
  GaugeChart,
  GraphChart,
  HeatmapChart,
  LineChart,
  PieChart,
  PictorialBarChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
  SunburstChart,
  TreeChart,
  TreemapChart
} from "echarts/charts";
import {
  AriaComponent,
  AxisPointerComponent,
  CalendarComponent,
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  PolarComponent,
  RadarComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  TransformComponent,
  VisualMapComponent
} from "echarts/components";
import { LabelLayout } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";
import type {
  EChartsEngine,
  EChartsInstanceLike
} from "./types.js";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  RadarChart,
  HeatmapChart,
  BoxplotChart,
  CandlestickChart,
  TreeChart,
  TreemapChart,
  SunburstChart,
  GraphChart,
  SankeyChart,
  ChordChart,
  FunnelChart,
  GaugeChart,
  PictorialBarChart,
  GridComponent,
  PolarComponent,
  RadarComponent,
  CalendarComponent,
  TitleComponent,
  LegendComponent,
  TooltipComponent,
  AxisPointerComponent,
  ToolboxComponent,
  DatasetComponent,
  TransformComponent,
  DataZoomComponent,
  VisualMapComponent,
  MarkPointComponent,
  MarkLineComponent,
  MarkAreaComponent,
  AriaComponent,
  LabelLayout,
  SVGRenderer
]);

export const defaultEChartsEngine: EChartsEngine = {
  init(container, theme, options) {
    return echarts.init(
      container,
      theme,
      options
    ) as unknown as EChartsInstanceLike;
  }
};
