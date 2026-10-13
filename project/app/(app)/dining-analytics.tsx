import { useCallback, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { BarChart, LineChart } from 'react-native-chart-kit';
import Svg, { Circle, G } from 'react-native-svg';
import { auth } from '../../firebaseConfig';
import { ThemeContext } from '../../context/ThemeContext';
import { adjacentAnalyticsPeriod, analyticsPeriodFor, subscribeAnalyticsRollup } from '../../utils/analytics';
import { dateKey, shiftDate } from '../../functions/lib/reporting';
import type { AnalyticsPeriodType, AnalyticsRollup, NutritionMetric } from '../../types/analytics';

const METRICS: NutritionMetric[] = ['calories', 'protein', 'carbs', 'fat'];
const LABELS = { calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];
const PERIOD_LABELS = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly', '3months': '3 Months' };
const TITLE = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const number = (value: number) => Math.round(value * 10) / 10;
const shortDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'Asia/Singapore' });

function DistributionChart({ data, dark, absolute = false }: { data: { name: string; value: number; color: string }[]; dark: boolean; absolute?: boolean }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const circumference = 2 * Math.PI * 60;
  let offset = 0;
  return (
    <View style={styles.distribution}>
      <Svg width={160} height={160} accessibilityLabel="Distribution chart">
        <G transform="rotate(-90 80 80)">
          {data.filter((item) => item.value > 0).map((item) => {
            const length = item.value / total * circumference;
            const start = offset;
            offset += length;
            return <Circle key={item.name} cx={80} cy={80} r={60} fill="none" stroke={item.color} strokeWidth={28} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-start} />;
          })}
        </G>
      </Svg>
      <View style={styles.legend}>
        {data.map((item) => <View key={item.name} style={styles.legendRow}><View style={[styles.swatch, { backgroundColor: item.color }]} /><Text style={[styles.text, dark && styles.textDark]}>{absolute ? item.value : `${number(item.value / total * 100)}%`} {item.name}</Text></View>)}
      </View>
    </View>
  );
}

export default function DiningAnalyticsScreen() {
  const { theme } = useContext(ThemeContext);
  const dark = theme === 'dark';
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(240, Math.min(width - 64, 680));
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid || null);
  const [period, setPeriod] = useState(() => analyticsPeriodFor(dateKey()!, 'day'));
  const [metric, setMetric] = useState<NutritionMetric>('calories');
  const [rollup, setRollup] = useState<AnalyticsRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionVersion, setSubscriptionVersion] = useState(0);
  const textStyle = [styles.text, dark && styles.textDark];
  const cardStyle = [styles.card, dark && styles.cardDark];
  const unit = metric === 'calories' ? 'kcal' : 'g';
  const currentPeriod = analyticsPeriodFor(dateKey()!, period.type);
  const lastPeriodDate = shiftDate(period.endDate, -1);
  const periodLabel = period.startDate.slice(0, 4) === lastPeriodDate.slice(0, 4)
    ? `${shortDate(period.startDate)} to ${shortDate(lastPeriodDate)} ${lastPeriodDate.slice(0, 4)}`
    : `${shortDate(period.startDate)} ${period.startDate.slice(0, 4)} to ${shortDate(lastPeriodDate)} ${lastPeriodDate.slice(0, 4)}`;

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setUid(user?.uid || null);
  }), []);

  const load = useCallback(() => { setSubscriptionVersion((version) => version + 1); }, []);
  useFocusEffect(useCallback(() => {
    setLoading(true); setError(null); setRollup(null);
    if (!uid) { setError('Please sign in to view your analytics.'); setLoading(false); return; }
    return subscribeAnalyticsRollup(uid, period, (summary) => {
      setRollup(summary); setError(null); setLoading(false);
    }, (failure) => {
      console.error('Analytics subscription failed:', failure.message);
      setError('Unable to sync analytics. Please check your connection and retry.'); setLoading(false);
    });
  }, [uid, period, subscriptionVersion]));

  const config = {
    backgroundGradientFrom: dark ? '#1e1e1e' : '#ffffff',
    backgroundGradientTo: dark ? '#1e1e1e' : '#ffffff',
    color: (opacity = 1) => `rgba(46, 204, 113, ${opacity})`,
    labelColor: (opacity = 1) => dark ? `rgba(240, 240, 240, ${opacity})` : `rgba(50, 50, 50, ${opacity})`,
    decimalPlaces: metric === 'calories' ? 0 : 1,
    propsForDots: { r: '3' },
    propsForLabels: { fontSize: 10, ...(Platform.OS === 'web' ? { origin: undefined } : {}) },
  };

  const switchType = (type: AnalyticsPeriodType) => {
    const anchor = period.id === currentPeriod.id ? dateKey()! : period.startDate;
    setPeriod(analyticsPeriodFor(anchor, type));
  };
  const metricValue = (value: number, missing: number) => `${number(value)} ${unit}${missing ? ' (partial)' : ''}`;
  const plot = (title: string, labels: string[], datasets: { data: number[]; color: (opacity?: number) => string }[], legend: string[], suffix = '') => (
    <View style={cardStyle}>
      <Text style={[textStyle, styles.cardTitle]}>{title}</Text>
      {labels.length > 1 ? (
        <ScrollView horizontal>
          <LineChart
            data={{ labels: labels.map((label, index) => index % Math.max(1, Math.ceil(labels.length / 6)) === 0 ? label : ''), datasets, legend }}
            width={chartWidth} height={225} chartConfig={config} fromZero yAxisSuffix={suffix} style={styles.chart} withDots={Platform.OS !== 'web'}
          />
        </ScrollView>
      ) : labels.length === 1 ? <>
        <Text style={textStyle}>{labels[0]}: {datasets.map((series, index) => `${legend[index]} ${number(series.data[0])}${suffix}`).join('; ')}.</Text>
        <ScrollView horizontal><BarChart data={{ labels: legend, datasets: [{ data: datasets.map((series) => series.data[0]) }] }} width={chartWidth} height={220} chartConfig={config} fromZero yAxisLabel="" yAxisSuffix={suffix} /></ScrollView>
        <Text style={textStyle}>Showing one entry date. Add more data to improve trend accuracy.</Text>
      </> : <Text style={textStyle}>This series has no calculable values for the selected dates. Record a meal for nutrition trends; save a plan on the same date for plan comparisons and adherence.</Text>}
    </View>
  );

  const renderSummary = (data: AnalyticsRollup) => {
    const actualPoints = data.daily.filter((day) => day.mealCount > 0 && !day.actualMissing[metric]);
    const comparisonPoints = data.daily.filter((day) => day.hasPlan && day.plannedMealCount > 0 && !day.plannedMissing[metric] && !day.actualMissing[metric]);
    const adherencePoints = data.daily.filter((day) => day.plannedMealCount > 0);
    const macroColors = ['#3498db', '#f39c12', '#e74c3c'];
    const macroData = (['protein', 'carbs', 'fat'] as const).map((name, index) => ({
      name: TITLE(name), value: data.actual[name] * (name === 'fat' ? 9 : 4), color: macroColors[index], legendFontColor: dark ? '#eee' : '#333', legendFontSize: 12,
    }));
    const locationData = Object.entries(data.mealCountsByLocation).filter(([, count]) => count > 0).map(([name, count], index) => ({
      name: name === 'custom' ? 'Custom/unspecified' : TITLE(name), value: count,
      color: ['#ff6b6b', '#2ecc71', '#3498db', '#999'][index], legendFontColor: dark ? '#eee' : '#333', legendFontSize: 12,
    }));
    const gap = data.gaps[metric];
    return (
      <>
        <View style={cardStyle}>
          <Text style={[textStyle, styles.cardTitle]}>Summary status</Text>
          <Text style={textStyle}>Last updated: {data.updatedAt ? data.updatedAt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }) : 'Unavailable'} (Singapore time)</Text>
          <Text style={textStyle}>{data.throughDate ? `Includes records through ${shortDate(data.throughDate)}.` : 'No dates in this period yet.'}</Text>
          <Text style={textStyle}>Today's intake is included and may be incomplete. Totals and charts update automatically as new summaries arrive.</Text>
          <Text style={textStyle}>{data.loggedDays} days with logs; {data.plannedDays} days with saved plans.</Text>
          {data.missingRollupCount ? <Text style={textStyle}>{data.missingRollupCount} monthly summaries are unavailable. Available monthly values are shown as partial.</Text> : null}
          <Text style={textStyle}>Missing logs are unknown intake. Comparisons describe recorded intake, and do not prove a meal was skipped.</Text>
        </View>

        {!data.plannedMealCount ? <View style={cardStyle}>
          <Text style={[textStyle, styles.cardTitle]}>Save a plan to enable comparisons</Text>
          <Text style={textStyle}>Your recorded meals are shown below. There are no identifiable saved planned meals for these dates, so planned calories, macro gaps and meal-plan adherence cannot be calculated. A calorie target is different from a saved meal plan.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/(app)/plan-my-day')} style={styles.button}><Text style={styles.buttonText}>Create and save today's plan</Text></TouchableOpacity>
        </View> : null}
        <View style={cardStyle}>
          <Text style={[textStyle, styles.cardTitle]}>Recorded nutrition</Text>
          {METRICS.map((name) => (
            <View key={name} style={styles.row}>
              <Text style={textStyle}>{LABELS[name]}</Text>
              <Text style={[textStyle, styles.value]}>{number(data.actual[name])} {name === 'calories' ? 'kcal' : 'g'}{data.actualMissing[name] ? ' (partial)' : ''}</Text>
            </View>
          ))}
          {data.loggedDays ? <Text style={textStyle}>Average per logged day: {number(data.actual[metric] / data.loggedDays)} {unit}{data.actualMissing[metric] ? ' (partial)' : ''}.</Text> : <Text style={textStyle}>No recorded intake in this period.</Text>}
          {METRICS.some((name) => data.actualMissing[name]) ? <Text style={textStyle}>Some records lack valid nutrition values. Available totals are shown; affected comparisons are unavailable.</Text> : null}
        </View>

        <View style={cardStyle}>
          <Text style={[textStyle, styles.cardTitle]}>Planned versus recorded {LABELS[metric].toLowerCase()}</Text>
          {data.comparableDays ? (
            <>
              <Text style={textStyle}>Compared across {data.comparableDays} days with identifiable planned meals.</Text>
              <View style={styles.row}><Text style={textStyle}>Planned</Text><Text style={[textStyle, styles.value]}>{metricValue(data.planned[metric], data.plannedMissing[metric])}</Text></View>
              <View style={styles.row}><Text style={textStyle}>Recorded on those days</Text><Text style={[textStyle, styles.value]}>{metricValue(data.comparableActual[metric], data.comparableActualMissing[metric])}</Text></View>
              <View style={styles.row}><Text style={textStyle}>Recorded minus planned</Text><Text style={[textStyle, styles.value]}>{gap === null ? 'Unavailable' : `${gap > 0 ? '+' : ''}${number(gap)} ${unit}`}</Text></View>
              {gap !== null && data.planned[metric] > 0 ? <Text style={textStyle}>{gap === 0 ? 'Recorded intake equals planned intake.' : `${number(Math.abs(gap) / data.planned[metric] * 100)}% ${gap < 0 ? 'below' : 'above'} planned intake.`}</Text> : null}
            </>
          ) : <><Text style={textStyle}>Recorded: {metricValue(data.actual[metric], data.actualMissing[metric])}</Text><Text style={textStyle}>Planned: no saved meal plan for these dates. Save a plan to calculate the difference.</Text></>}
          {data.legacyMissingPlanCount ? <Text style={textStyle}>{data.legacyMissingPlanCount} older slots have lost their planned meal details. Comparisons and adherence cover identifiable meals only and are partial.</Text> : null}
          {!data.legacyMissingPlanCount && !data.missingRollupCount && gap === null && data.comparableDays > 0 ? <Text style={textStyle}>This comparison needs valid {LABELS[metric].toLowerCase()} values for every relevant planned and recorded meal.</Text> : null}
        </View>

        <View style={cardStyle}>
          <Text style={[textStyle, styles.cardTitle]}>Macronutrient gaps</Text>
          <Text style={textStyle}>Planned and recorded intake on days with identifiable saved meals. Differences are recorded minus planned.</Text>
          <View style={styles.row}>
            <Text style={textStyle}>Macro</Text><Text style={textStyle}>Planned / Recorded / Difference</Text>
          </View>
          {(['protein', 'carbs', 'fat'] as const).map((name) => (
            <View key={name} style={styles.row}>
              <Text style={textStyle}>{LABELS[name]}</Text>
              <Text style={[textStyle, styles.value]}>{data.comparableDays ? `${number(data.planned[name])} g` : 'No plan'}{data.plannedMissing[name] ? ' (partial)' : ''} / {number(data.comparableDays ? data.comparableActual[name] : data.actual[name])} g{data.comparableActualMissing[name] ? ' (partial)' : ''} / {data.gaps[name] === null ? 'Unavailable' : `${data.gaps[name]! > 0 ? '+' : ''}${number(data.gaps[name]!)} g`}</Text>
            </View>
          ))}
          <Text style={textStyle}>Negative values indicate a recorded shortfall; positive values indicate a recorded excess.</Text>
          {data.comparableDays === 0 ? <Text style={textStyle}>No identifiable saved meals are available for comparison.</Text> : data.legacyMissingPlanCount > 0 ? <Text style={textStyle}>Older plan details are missing; these gaps compare identifiable planned meals only.</Text> : METRICS.some((name) => data.plannedMissing[name] || data.comparableActualMissing[name]) ? <Text style={textStyle}>Affected gaps are unavailable because nutrition values are missing or invalid.</Text> : null}
        </View>

        <View style={cardStyle}>
          <Text style={[textStyle, styles.cardTitle]}>Confirmed meal-plan adherence</Text>
          <Text style={[styles.highlight]}>{data.adherencePercent === null ? 'Unavailable' : `${number(data.adherencePercent)}%`}</Text>
          <Text style={textStyle}>{data.followedMealCount} confirmed matches out of {data.plannedMealCount} identifiable planned meals; {data.linkedMealCount} meals were logged from the plan.</Text>
          <Text style={textStyle}>A match is a same-day recorded meal with the planned dish and nutrition values. Manual logs must also match the meal type. Each recorded meal can confirm one planned slot. Missing logs remain unconfirmed.</Text>
          {data.legacyMissingPlanCount > 0 && data.adherencePercent !== null ? <Text style={textStyle}>Partial adherence: slots without saved meal details are excluded.</Text> : null}
          {data.adherencePercent === null ? <Text style={textStyle}>{data.missingRollupCount ? 'Some monthly summaries are unavailable; displayed comparisons cover the available summaries.' : data.legacyMissingPlanCount ? 'Older plan details are missing.' : 'No identifiable planned meals in this period.'}</Text> : null}
        </View>

        {plot(`${LABELS[metric]} trends`, actualPoints.map((day) => shortDate(day.date)), [{ data: actualPoints.map((day) => day.actual[metric]), color: () => '#2ecc71' }], ['Recorded'], metric === 'calories' ? '' : 'g')}
        {plot('Planned versus recorded trends', comparisonPoints.map((day) => shortDate(day.date)), [
          { data: comparisonPoints.map((day) => day.planned[metric]), color: () => '#3498db' },
          { data: comparisonPoints.map((day) => day.actual[metric]), color: () => '#2ecc71' },
        ], ['Planned', 'Recorded'])}
        {plot(`Recorded minus planned ${LABELS[metric].toLowerCase()} trends`, comparisonPoints.map((day) => shortDate(day.date)), [{
          data: comparisonPoints.map((day) => day.deviation?.[metric] ?? day.actual[metric] - day.planned[metric]), color: () => '#9b59b6',
        }], ['Deviation'], metric === 'calories' ? ' kcal' : ' g')}
        <Text style={[textStyle, { marginBottom: 16 }]}>Deviation above zero means recorded excess; below zero means recorded shortfall. Dates without identifiable plans or complete nutrition are omitted.</Text>
        {plot('Confirmed adherence trends', adherencePoints.map((day) => shortDate(day.date)), [{ data: adherencePoints.map((day) => day.followedMealCount / day.plannedMealCount * 100), color: () => '#2ecc71' }], ['Confirmed matches'], '%')}

        <View style={cardStyle}>
          <Text style={[textStyle, styles.cardTitle]}>Calories by meal type</Text>
          {data.mealCount ? (
            <>
              <ScrollView horizontal><BarChart data={{ labels: MEAL_TYPES.map(TITLE), datasets: [{ data: MEAL_TYPES.map((type) => data.caloriesByMealType[type] || 0) }] }} width={chartWidth} height={220} chartConfig={config} fromZero yAxisLabel="" yAxisSuffix="" /></ScrollView>
              {MEAL_TYPES.map((type) => <Text key={type} style={textStyle}>{TITLE(type)}: {number(data.caloriesByMealType[type] || 0)} kcal{data.actual.calories > 0 ? ` (${number((data.caloriesByMealType[type] || 0) / data.actual.calories * 100)}%)` : ''}</Text>)}
              {data.actualMissing.calories > 0 ? <Text style={textStyle}>Partial breakdown: some meals lack valid calorie values.</Text> : null}
            </>
          ) : <Text style={textStyle}>No meal logs in this period.</Text>}
        </View>

        <View style={cardStyle}>
          <Text style={[textStyle, styles.cardTitle]}>Macro distribution (calories)</Text>
          {macroData.some((item) => item.value > 0) ? <DistributionChart data={macroData} dark={dark} /> : <Text style={textStyle}>No macronutrient data in this period.</Text>}
          {(['protein', 'carbs', 'fat'] as const).some((name) => data.actualMissing[name]) ? <Text style={textStyle}>Partial distribution: some records lack macro values.</Text> : null}
        </View>
        <View style={cardStyle}>
          <Text style={[textStyle, styles.cardTitle]}>Personalised insights</Text>
          {data.insightsVersion === 1 && data.insights?.length ? data.insights.map((insight) => (
            <View key={insight.id} style={{ marginBottom: 12 }}>
              <Text style={[textStyle, styles.value, { textAlign: 'left' }]}>{insight.title}</Text>
              <Text style={textStyle}>{insight.message}</Text>
            </View>
          )) : <Text style={textStyle}>Insights will appear after the next backend summary update.</Text>}
          {data.missingRollupCount ? <Text style={textStyle}>These observations cover available monthly summaries only.</Text> : null}
        </View>
        <View style={cardStyle}>
          <Text style={[textStyle, styles.cardTitle]}>Meal counts by type</Text>
          {MEAL_TYPES.map((type) => <View key={type} style={styles.row}><Text style={textStyle}>{TITLE(type)}</Text><Text style={[textStyle, styles.value]}>{data.mealCountsByType[type] || 0}</Text></View>)}
        </View>
        <View style={cardStyle}>
          <Text style={[textStyle, styles.cardTitle]}>Meal locations</Text>
          {locationData.length ? <DistributionChart data={locationData} dark={dark} absolute /> : <Text style={textStyle}>No meal locations in this period.</Text>}
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/(app)/meal-history')} style={styles.button}><Text style={styles.buttonText}>View meal history and map</Text></TouchableOpacity>
        </View>
      </>
    );
  };

  return (
    <View style={[styles.container, dark && styles.containerDark]}>
      <View style={[styles.header, dark && styles.cardDark]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.iconButton}><ArrowLeft size={24} color="#2ecc71" /></TouchableOpacity>
        <Text style={[textStyle, styles.title]}>Nutrition Analytics</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={cardStyle}>
          <View style={styles.controls}>
            {(['day', 'week', 'month', 'year'] as const).map((type) => <TouchableOpacity key={type} accessibilityRole="button" accessibilityState={{ selected: period.type === type }} onPress={() => switchType(type)} style={[styles.periodButton, period.type === type && styles.selectedButton]}><Text style={period.type === type ? styles.buttonText : textStyle}>{PERIOD_LABELS[type]}</Text></TouchableOpacity>)}
          </View>
          <View style={styles.controls}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous period" onPress={() => setPeriod(adjacentAnalyticsPeriod(period, -1))} style={styles.iconButton}><ChevronLeft color="#2ecc71" /></TouchableOpacity>
            <Text style={[textStyle, styles.periodLabel]}>{periodLabel}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next period" accessibilityState={{ disabled: period.startDate >= currentPeriod.startDate }} disabled={period.startDate >= currentPeriod.startDate} onPress={() => {
              const next = adjacentAnalyticsPeriod(period, 1);
              setPeriod(next.startDate > currentPeriod.startDate ? currentPeriod : next);
            }} style={styles.iconButton}><ChevronRight color={period.startDate >= currentPeriod.startDate ? '#999' : '#2ecc71'} /></TouchableOpacity>
          </View>
          {period.id !== currentPeriod.id ? <TouchableOpacity accessibilityRole="button" onPress={() => setPeriod(currentPeriod)}><Text style={styles.link}>Return to current period</Text></TouchableOpacity> : null}
          <View style={styles.controls}>
            {METRICS.map((name) => <TouchableOpacity key={name} accessibilityRole="button" accessibilityState={{ selected: metric === name }} onPress={() => setMetric(name)} style={[styles.metricButton, metric === name && styles.selectedButton]}><Text style={metric === name ? styles.buttonText : textStyle}>{LABELS[name]}</Text></TouchableOpacity>)}
          </View>
        </View>
        {loading ? <View style={cardStyle}><ActivityIndicator size="large" color="#2ecc71" /><Text style={textStyle}>Loading summary...</Text></View> : error ? (
          <View style={cardStyle}><Text style={textStyle}>{error}</Text><TouchableOpacity accessibilityRole="button" onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>Retry</Text></TouchableOpacity></View>
        ) : rollup ? renderSummary(rollup) : (
          <View style={cardStyle}>
            <Text style={[textStyle, styles.cardTitle]}>No summary available yet</Text>
            <Text style={textStyle}>Summaries are generated from saved plans and meal logs by the backend. Keep the local analytics worker running while testing. Historical periods without records may have no summary.</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>Check again</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/(app)/meal-logging')} style={styles.iconButton}><Text style={styles.link}>Log a meal</Text></TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  containerDark: { backgroundColor: '#121212' },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingTop: 48, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 21, fontWeight: '700', marginLeft: 8 },
  content: { padding: 16, paddingBottom: 100, width: '100%', maxWidth: 760, alignSelf: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
  cardDark: { backgroundColor: '#1e1e1e' },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  text: { color: '#333', fontSize: 14, lineHeight: 22, flexShrink: 1 },
  textDark: { color: '#eee' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 5 },
  value: { fontWeight: '600', textAlign: 'right' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  periodLabel: { flex: 1, textAlign: 'center' },
  iconButton: { padding: 10, minHeight: 44, minWidth: 44, justifyContent: 'center' },
  periodButton: { flexGrow: 1, minWidth: 132, alignItems: 'center', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#2ecc71' },
  metricButton: { padding: 10, borderRadius: 8, minHeight: 44 },
  selectedButton: { backgroundColor: '#238c50' },
  button: { backgroundColor: '#238c50', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  highlight: { fontSize: 30, fontWeight: '700', color: '#2ecc71', marginVertical: 8 },
  link: { color: '#2ecc71', fontWeight: '600' },
  chart: { borderRadius: 8 },
  distribution: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  legend: { flex: 1, minWidth: 120 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 4 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
});
