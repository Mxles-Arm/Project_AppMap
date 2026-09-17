import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { confirmStillAccurate, getAll, initDB, insert, remove, setStatus, update, type Toilet, type ToiletStatus } from '../db/toilets';
import { decodePolyline, formatDuration, getWalkingRoute } from '../utils/directions';
import { useLocation } from '../hooks/useLocation';
import { findNearest, formatDistance, haversine } from '../utils/distance';
import { formatRelativeTime } from '../utils/time';
import { getStats, recordAdded, recordConfirmed, recordStatusUpdated, type ContributionStats } from '../utils/stats';
import { AccessibleGlyph, RestroomGlyph } from '../components/glyphs';
import { useLanguage } from '../i18n/useLanguage';

const KMUTNB = { latitude: 13.819552, longitude: 100.514812 };
const DELTA = { latitudeDelta: 0.005, longitudeDelta: 0.005 };

// Natural palette — moss/teal tones on clean, solid surfaces.
const C = {
  ink: '#1C2521',
  inkSoft: '#5B6B60',
  paper: '#F5F2E9',
  surface: '#FFFFFF',
  line: '#D6E4D0',
  primary: '#0D9488',
  primaryDark: '#0F766E',
  urgent: '#DC2626',
};

export default function Index() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const { location } = useLocation();
  const { language, setLanguage, t } = useLanguage();

  const STATUS_LABEL: Record<ToiletStatus, string> = {
    available: t.statusAvailable,
    closed: t.statusClosed,
    no_paper: t.statusNoPaper,
  };

  const [toilets, setToilets] = useState<Toilet[]>([]);
  const [nearest, setNearest] = useState<{ toilet: Toilet; distance: number; skippedClosed?: boolean } | null>(null);
  const [resultExpanded, setResultExpanded] = useState(true);
  const [route, setRoute] = useState<{ latitude: number; longitude: number }[] | null>(null);
  const [walkInfo, setWalkInfo] = useState<{ distanceMeters: number; durationSeconds: number } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [listVisible, setListVisible] = useState(false);
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stats, setStats] = useState<ContributionStats>({ added: 0, confirmed: 0, statusUpdated: 0 });
  const [statsVisible, setStatsVisible] = useState(false);
  const [pickedPoint, setPickedPoint] = useState<{ latitude: number; longitude: number } | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [building, setBuilding] = useState('');
  const [floor, setFloor] = useState('');
  const [accessible, setAccessible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    initDB().then(loadToilets);
    getStats().then(setStats);
  }, []);

  // Fetches the walking route from the Directions API whenever the focused toilet or
  // location changes; synchronizing with this external API is exactly what an effect is for.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!nearest || !location) {
      setRoute(null);
      setWalkInfo(null);
      return;
    }
    let active = true;
    setRouteLoading(true);
    getWalkingRoute(location, { latitude: nearest.toilet.latitude, longitude: nearest.toilet.longitude })
      .then(result => {
        if (!active) return;
        if (result) {
          setRoute(decodePolyline(result.polyline));
          setWalkInfo({ distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds });
        } else {
          setRoute(null);
          setWalkInfo(null);
        }
      })
      .finally(() => { if (active) setRouteLoading(false); });
    return () => { active = false; };
  }, [nearest?.toilet.id, location?.latitude, location?.longitude]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function loadToilets() {
    const data = await getAll();
    setToilets(data);
  }

  function handleFindNearest() {
    if (!location) {
      Alert.alert(t.alertNoLocationTitle, t.alertNoLocationBody);
      return;
    }
    if (toilets.length === 0) {
      Alert.alert(t.alertNoToiletsTitle, t.alertNoToiletsBody);
      return;
    }
    const result = findNearest(toilets, location);
    if (!result) return;
    setNearest(result);
    setResultExpanded(true);
    mapRef.current?.animateToRegion({
      latitude: result.toilet.latitude,
      longitude: result.toilet.longitude,
      ...DELTA,
    }, 600);
  }

  function openModal(point?: { latitude: number; longitude: number }) {
    if (!point && !location) {
      Alert.alert(t.alertNoLocationTitle, t.alertNoLocationBodyWait);
      return;
    }
    setEditingId(null);
    setBuilding('');
    setFloor('');
    setAccessible(false);
    setPickedPoint(point ?? null);
    setModalVisible(true);
  }

  function openEditModal(t: Toilet) {
    setListVisible(false);
    setEditingId(t.id);
    setBuilding(t.building);
    setFloor(t.floor);
    setAccessible(t.accessible === 1);
    setPickedPoint(null);
    setModalVisible(true);
  }

  function handleMapLongPress(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) {
    openModal(e.nativeEvent.coordinate);
  }

  async function handleSave() {
    if (!building.trim()) {
      Alert.alert(t.alertNeedBuilding);
      return;
    }
    setSaving(true);
    try {
      if (editingId !== null) {
        await update(editingId, {
          building: building.trim(),
          floor: floor.trim(),
          accessible: accessible ? 1 : 0,
        });
      } else {
        const point = pickedPoint ?? location;
        if (!point) return;
        await insert({
          building: building.trim(),
          floor: floor.trim(),
          accessible: accessible ? 1 : 0,
          latitude: point.latitude,
          longitude: point.longitude,
        });
        setStats(await recordAdded());
      }
      await loadToilets();
      setNearest(null);
      setModalVisible(false);
      setPickedPoint(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number, name: string) {
    Alert.alert(
      t.alertDeleteTitle,
      t.alertDeleteBody(name),
      [
        { text: t.alertCancel, style: 'cancel' },
        {
          text: t.alertDelete,
          style: 'destructive',
          onPress: async () => {
            await remove(id);
            await loadToilets();
            setNearest(prev => (prev?.toilet.id === id ? null : prev));
          },
        },
      ]
    );
  }

  async function handleSetStatus(id: number, status: ToiletStatus) {
    await setStatus(id, status);
    await loadToilets();
    setNearest(prev => (prev && prev.toilet.id === id ? { ...prev, toilet: { ...prev.toilet, status, updated_at: Date.now() } } : prev));
    setStats(await recordStatusUpdated());
  }

  async function handleConfirm(id: number) {
    await confirmStillAccurate(id);
    await loadToilets();
    setNearest(prev => (prev && prev.toilet.id === id ? { ...prev, toilet: { ...prev.toilet, updated_at: Date.now() } } : prev));
    setStats(await recordConfirmed());
  }

  function recenter() {
    if (!location) return;
    mapRef.current?.animateToRegion({ ...location, ...DELTA }, 500);
  }

  function navigateTo(t: Toilet) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${t.latitude},${t.longitude}`;
    Linking.openURL(url);
  }

  function handleUrgentMode(accessibleOnlyMode = false) {
    if (!location) {
      Alert.alert(t.alertNoLocationTitle, t.alertNoLocationBody);
      return;
    }
    const pool = accessibleOnlyMode ? toilets.filter(toilet => toilet.accessible === 1) : toilets;
    if (pool.length === 0) {
      Alert.alert(
        accessibleOnlyMode ? t.alertNoToiletsAccessibleTitle : t.alertNoToiletsTitle,
        t.alertNoToiletsBody
      );
      return;
    }
    const result = findNearest(toilets, location, { accessibleOnly: accessibleOnlyMode });
    if (!result) return;
    navigateTo(result.toilet);
  }

  const sortedFilteredToilets = useMemo(() => {
    let list = toilets;
    if (accessibleOnly) list = list.filter(t => t.accessible === 1);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(t =>
        t.building.toLowerCase().includes(q) || t.floor.toLowerCase().includes(q)
      );
    }
    if (location) {
      list = [...list].sort((a, b) =>
        haversine(location.latitude, location.longitude, a.latitude, a.longitude) -
        haversine(location.latitude, location.longitude, b.latitude, b.longitude)
      );
    }
    return list;
  }, [toilets, accessibleOnly, searchQuery, location]);

  function focusToilet(t: Toilet) {
    setListVisible(false);
    mapRef.current?.animateToRegion({
      latitude: t.latitude,
      longitude: t.longitude,
      ...DELTA,
    }, 600);
    if (location) {
      setNearest({ toilet: t, distance: haversine(location.latitude, location.longitude, t.latitude, t.longitude) });
      setResultExpanded(true);
    }
  }

  const distanceSortedToilets = useMemo(() => {
    if (!location) return toilets;
    return [...toilets].sort((a, b) =>
      haversine(location.latitude, location.longitude, a.latitude, a.longitude) -
      haversine(location.latitude, location.longitude, b.latitude, b.longitude)
    );
  }, [toilets, location]);

  function focusToiletByOffset(offset: number) {
    if (!nearest || distanceSortedToilets.length === 0) return;
    const currentIndex = distanceSortedToilets.findIndex(t => t.id === nearest.toilet.id);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + offset + distanceSortedToilets.length) % distanceSortedToilets.length;
    focusToilet(distanceSortedToilets[nextIndex]);
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headerCard}>
          <View style={styles.headerIcon}>
            <RestroomGlyph size={24} color={C.primary} />
          </View>
          <TouchableOpacity
            style={styles.headerMain}
            onPress={() => setListVisible(true)}
            activeOpacity={0.7}
            disabled={toilets.length === 0}
          >
            <View>
              <Text style={styles.headerTitle}>{t.appName}</Text>
              <Text style={styles.headerSub}>
                {toilets.length > 0
                  ? t.headerSubCount(toilets.length)
                  : location ? t.headerSubEmpty : t.headerSubLocating}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.statsBtn}
            onPress={() => setStatsVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.statsBtnText}>{t.statsBtn}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => openModal()}
            activeOpacity={0.7}
          >
            <Text style={styles.addBtnText}>{t.addBtn}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Map */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{ ...KMUTNB, ...DELTA }}
        showsUserLocation
        showsMyLocationButton={false}
        onLongPress={handleMapLongPress}
      >
        {toilets.map(t => (
          <Marker
            key={t.id}
            coordinate={{ latitude: t.latitude, longitude: t.longitude }}
            pinColor={t.status === 'closed' ? '#DC2626' : '#22C55E'}
            onPress={() => focusToilet(t)}
          />
        ))}
        {pickedPoint && modalVisible && editingId === null && (
          <Marker coordinate={pickedPoint} pinColor="#F59E0B" />
        )}
        {route && (
          <Polyline coordinates={route} strokeColor={C.ink} strokeWidth={4} />
        )}
      </MapView>


      {/* Recenter button */}
      {!nearest && (
        <TouchableOpacity
          style={[styles.recenterBtn, { bottom: insets.bottom + 152 }]}
          onPress={recenter}
          activeOpacity={0.85}
        >
          <View style={styles.recenterRing} />
        </TouchableOpacity>
      )}

      {/* Result card */}
      {nearest && (
        <View style={[styles.resultCard, { paddingBottom: insets.bottom }]}>
          <View style={styles.resultSection}>
            <View style={styles.resultTitleRow}>
              <Text style={styles.resultBuilding} numberOfLines={1}>
                {nearest.toilet.building}
                {nearest.toilet.floor ? ` · ${nearest.toilet.floor}` : ''}
              </Text>
              {nearest.toilet.accessible === 1 && (
                <AccessibleGlyph size={16} color={C.inkSoft} />
              )}
              <TouchableOpacity
                style={styles.resultIconBtn}
                onPress={() => setResultExpanded(v => !v)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.resultIconBtnText}>{resultExpanded ? '⌄' : '⌃'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.resultIconBtn}
                onPress={() => setNearest(null)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.resultIconBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {distanceSortedToilets.length > 1 && (
              <View style={styles.resultNavRow}>
                <TouchableOpacity
                  style={styles.resultNavArrow}
                  onPress={() => focusToiletByOffset(-1)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.resultNavArrowText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.resultNavPosition}>
                  {distanceSortedToilets.findIndex(item => item.id === nearest.toilet.id) + 1} / {distanceSortedToilets.length}
                </Text>
                <TouchableOpacity
                  style={styles.resultNavArrow}
                  onPress={() => focusToiletByOffset(1)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.resultNavArrowText}>›</Text>
                </TouchableOpacity>
              </View>
            )}

            {routeLoading ? (
              <Text style={styles.resultWalkLoading}>{t.resultCalculating}</Text>
            ) : walkInfo ? (
              <Text style={styles.resultDistance}>
                {t.resultWalk(formatDuration(walkInfo.durationSeconds), formatDistance(walkInfo.distanceMeters))}
              </Text>
            ) : (
              <Text style={styles.resultDistance}>{formatDistance(nearest.distance)}</Text>
            )}
          </View>

          {resultExpanded && (
            <>
              <View style={styles.resultDivider} />

              <View style={styles.resultSection}>
                <Text style={styles.resultSectionLabel}>{t.resultStatusNow}</Text>
                <View style={styles.statusRow}>
                  {(['available', 'closed', 'no_paper'] as ToiletStatus[]).map(s => {
                    const active = nearest.toilet.status === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        style={[
                          styles.statusChip,
                          active && (s === 'closed' ? styles.statusChipUrgent : styles.statusChipActive),
                        ]}
                        onPress={() => handleSetStatus(nearest.toilet.id, s)}
                        activeOpacity={0.8}
                      >
                        <Text style={[
                          styles.statusChipText,
                          active && (s === 'closed' ? styles.statusChipUrgentText : styles.statusChipActiveText),
                        ]}>
                          {STATUS_LABEL[s]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.updatedRow}>
                  <Text style={styles.updatedText}>{t.resultUpdated(formatRelativeTime(nearest.toilet.updated_at))}</Text>
                  <TouchableOpacity onPress={() => handleConfirm(nearest.toilet.id)} activeOpacity={0.7}>
                    <Text style={styles.confirmText}>{t.resultConfirm}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.resultDivider} />

              <View style={styles.resultCardActions}>
                <TouchableOpacity
                  style={styles.resultNavBtn}
                  onPress={() => navigateTo(nearest.toilet)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.resultNavText}>{t.resultNav}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.resultDeleteBtn}
                  onPress={() => handleDelete(nearest.toilet.id, `${nearest.toilet.building} ${nearest.toilet.floor}`)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.resultDeleteText}>{t.resultDelete}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}

      {/* Bottom controls */}
      {!nearest && (
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity style={styles.btnFind} onPress={handleFindNearest} activeOpacity={0.9}>
          <Text style={styles.btnFindText}>{t.btnFind}</Text>
        </TouchableOpacity>

        <View style={styles.urgentRow}>
          <TouchableOpacity
            style={styles.btnUrgent}
            onPress={() => handleUrgentMode(false)}
            activeOpacity={0.85}
          >
            <Text style={styles.btnUrgentText}>{t.btnUrgent}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnUrgentAccessible}
            onPress={() => handleUrgentMode(true)}
            activeOpacity={0.85}
          >
            <AccessibleGlyph size={16} color={C.ink} />
            <Text style={styles.btnUrgentAccessibleText}>{t.btnUrgentAccessible}</Text>
          </TouchableOpacity>
        </View>
      </View>
      )}

      {/* Add Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => { setModalVisible(false); setPickedPoint(null); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{editingId !== null ? t.modalEditTitle : t.modalAddTitle}</Text>
            <Text style={styles.modalSub}>
              {editingId !== null
                ? t.modalEditSub
                : pickedPoint
                  ? t.modalPickedSub
                  : t.modalGpsSub}
            </Text>

            <Text style={styles.fieldLabel}>{t.fieldBuilding}</Text>
            <TextInput
              style={styles.input}
              placeholder={t.fieldBuildingPlaceholder}
              placeholderTextColor={C.inkSoft}
              value={building}
              onChangeText={setBuilding}
            />

            <Text style={styles.fieldLabel}>{t.fieldFloor}</Text>
            <TextInput
              style={styles.input}
              placeholder={t.fieldFloorPlaceholder}
              placeholderTextColor={C.inkSoft}
              value={floor}
              onChangeText={setFloor}
            />

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>{t.fieldAccessible}</Text>
              <Switch
                value={accessible}
                onValueChange={setAccessible}
                trackColor={{ false: C.line, true: C.ink }}
                thumbColor={C.surface}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.btnCancel}
                onPress={() => { setModalVisible(false); setPickedPoint(null); }}
                activeOpacity={0.8}
              >
                <Text style={styles.btnCancelText}>{t.alertCancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnSave, saving && styles.btnDisabled]}
                onPress={handleSave}
                activeOpacity={0.85}
                disabled={saving}
              >
                <Text style={styles.btnSaveText}>
                  {saving ? t.btnSaving : editingId !== null ? t.btnSaveEdit : t.btnSave}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* List Modal */}
      <Modal
        visible={listVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setListVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, styles.listSheet]}>
            <View style={styles.listHeader}>
              <Text style={styles.modalTitle}>{t.listTitle(sortedFilteredToilets.length)}</Text>
              <TouchableOpacity
                style={[styles.filterChip, accessibleOnly && styles.filterChipActive]}
                onPress={() => setAccessibleOnly(v => !v)}
                activeOpacity={0.8}
              >
                <Text style={[styles.filterChipText, accessibleOnly && styles.filterChipActiveText]}>
                  {t.listAccessibleOnly}
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder={t.searchPlaceholder}
              placeholderTextColor={C.inkSoft}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <Text style={styles.modalSub}>{t.listSortHint}</Text>
            <ScrollView style={styles.listScroll}>
              {sortedFilteredToilets.map(item => {
                const dist = location
                  ? haversine(location.latitude, location.longitude, item.latitude, item.longitude)
                  : null;
                return (
                  <View key={item.id} style={styles.listRow}>
                    <TouchableOpacity
                      style={styles.listRowMain}
                      onPress={() => focusToilet(item)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.listStatusMark, item.status === 'closed' && styles.listStatusMarkUrgent]} />
                      <View style={styles.listRowText}>
                        <Text style={styles.listRowTitle}>
                          {item.building}{item.floor ? ` · ${item.floor}` : ''}
                        </Text>
                        <Text style={styles.listRowSub}>
                          {item.accessible === 1 ? t.listAccessibleTag : ''}{STATUS_LABEL[item.status]} · {formatRelativeTime(item.updated_at)}
                        </Text>
                      </View>
                      {dist !== null && (
                        <Text style={styles.listRowDist}>{formatDistance(dist)}</Text>
                      )}
                    </TouchableOpacity>
                    <View style={styles.listRowActions}>
                      <TouchableOpacity onPress={() => navigateTo(item)} activeOpacity={0.7} style={styles.listRowIconBtn}>
                        <Text style={styles.listRowIconText}>{t.listNav}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => openEditModal(item)} activeOpacity={0.7} style={styles.listRowIconBtn}>
                        <Text style={styles.listRowIconText}>{t.listEdit}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
              {sortedFilteredToilets.length === 0 && (
                <Text style={styles.listEmpty}>{t.listEmpty}</Text>
              )}
            </ScrollView>
            <TouchableOpacity
              style={styles.btnCancel}
              onPress={() => setListVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnCancelText}>{t.close}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Stats Modal */}
      <Modal
        visible={statsVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setStatsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{t.statsTitle}</Text>
            <Text style={styles.modalSub}>{t.statsSub}</Text>

            <View style={styles.statsGrid}>
              <View style={styles.statsCard}>
                <Text style={styles.statsNumber}>{stats.added}</Text>
                <Text style={styles.statsLabel}>{t.statsAdded}</Text>
              </View>
              <View style={styles.statsCard}>
                <Text style={styles.statsNumber}>{stats.confirmed}</Text>
                <Text style={styles.statsLabel}>{t.statsConfirmed}</Text>
              </View>
              <View style={styles.statsCard}>
                <Text style={styles.statsNumber}>{stats.statusUpdated}</Text>
                <Text style={styles.statsLabel}>{t.statsUpdated}</Text>
              </View>
            </View>

            <View style={styles.languageRow}>
              <Text style={styles.fieldLabel}>{t.languageLabel}</Text>
              <View style={styles.languageSwitch}>
                <TouchableOpacity
                  style={[styles.languageOption, language === 'th' && styles.languageOptionActive]}
                  onPress={() => setLanguage('th')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.languageOptionText, language === 'th' && styles.languageOptionTextActive]}>
                    ไทย
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.languageOption, language === 'en' && styles.languageOptionActive]}
                  onPress={() => setLanguage('en')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.languageOptionText, language === 'en' && styles.languageOptionTextActive]}>
                    EN
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={styles.btnCancel}
              onPress={() => setStatsVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnCancelText}>{t.close}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },

  header: {
    backgroundColor: C.primary,
    paddingBottom: 16,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerCard: {
    marginHorizontal: 16,
    backgroundColor: C.surface,
    borderRadius: 28,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(13,148,136,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMain: { flex: 1, minHeight: 44, justifyContent: 'center' },
  headerTitle: { fontSize: 19, fontWeight: '800', color: C.ink, letterSpacing: 0.3 },
  headerSub: { fontSize: 12, color: C.inkSoft, marginTop: 3 },
  statsBtn: {
    minWidth: 40,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  statsBtnText: { fontSize: 12, fontWeight: '700', color: C.inkSoft },
  addBtn: {
    minWidth: 40,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  addBtnText: { fontSize: 12, fontWeight: '700', color: C.surface },

  map: { flex: 1 },

  recenterBtn: {
    position: 'absolute',
    right: 12,
    zIndex: 10,
    elevation: 10,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: C.line,
  },
  recenterRing: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: C.primary,
  },

  resultCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1.5,
    borderColor: C.line,
    overflow: 'hidden',
  },
  resultSection: { padding: 16 },
  resultDivider: { height: 1, backgroundColor: C.line },
  resultSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.inkSoft,
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  resultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultBuilding: { flex: 1, fontSize: 17, fontWeight: '800', color: C.ink },
  resultIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultIconBtnText: { fontSize: 13, fontWeight: '700', color: C.inkSoft },
  resultNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginTop: 10,
  },
  resultNavArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultNavArrowText: { fontSize: 18, fontWeight: '800', color: C.primaryDark },
  resultNavPosition: { fontSize: 12, fontWeight: '700', color: C.inkSoft },
  resultDistance: { fontSize: 22, fontWeight: '800', color: C.ink, marginTop: 8, letterSpacing: -0.3 },
  resultWalkLoading: { fontSize: 13, color: C.inkSoft, marginTop: 8 },
  statusRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statusChip: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.line,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  statusChipActive: { borderColor: C.primary, backgroundColor: C.primary },
  statusChipUrgent: { borderColor: C.urgent, backgroundColor: C.urgent },
  statusChipText: { fontSize: 12, fontWeight: '700', color: C.inkSoft },
  statusChipActiveText: { color: C.surface },
  statusChipUrgentText: { color: C.surface },
  updatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    gap: 8,
  },
  updatedText: { fontSize: 12, color: C.inkSoft },
  confirmText: { fontSize: 12, color: C.primaryDark, fontWeight: '700' },
  resultCardActions: { flexDirection: 'row', gap: 10, padding: 16 },
  resultNavBtn: {
    flex: 1,
    backgroundColor: C.primary,
    borderRadius: 20,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultNavText: { color: C.surface, fontSize: 14, fontWeight: '700' },
  resultDeleteBtn: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.urgent,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultDeleteText: { color: C.urgent, fontSize: 14, fontWeight: '700' },

  bottomBar: {
    backgroundColor: C.surface,
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  btnFind: {
    backgroundColor: C.primary,
    borderRadius: 24,
    paddingVertical: 17,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFindText: { color: C.surface, fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
  urgentRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  btnUrgent: {
    flex: 1,
    backgroundColor: C.urgent,
    borderRadius: 20,
    paddingVertical: 13,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnUrgentText: { color: C.surface, fontSize: 14, fontWeight: '800' },
  btnUrgentAccessible: {
    minWidth: 100,
    minHeight: 48,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  btnUrgentAccessibleText: { color: C.ink, fontSize: 13, fontWeight: '800' },

  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(28,37,33,0.35)',
  },
  modalSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 32,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: C.ink, marginBottom: 4 },
  modalSub: { fontSize: 13, color: C.inkSoft, marginBottom: 20 },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: C.inkSoft, marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: C.ink,
    backgroundColor: C.paper,
    marginBottom: 16,
    minHeight: 48,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },

  modalActions: { flexDirection: 'row', gap: 12 },
  btnCancel: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.line,
    paddingVertical: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancelText: { fontSize: 15, fontWeight: '700', color: C.inkSoft },
  btnSave: {
    flex: 2,
    backgroundColor: C.primary,
    borderRadius: 20,
    paddingVertical: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSaveText: { fontSize: 15, fontWeight: '700', color: C.surface },
  btnDisabled: { opacity: 0.5 },

  listSheet: { maxHeight: '80%' },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  filterChip: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.line,
    paddingVertical: 7,
    paddingHorizontal: 12,
    minHeight: 32,
  },
  filterChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterChipText: { fontSize: 12, fontWeight: '700', color: C.inkSoft },
  filterChipActiveText: { color: C.surface },
  searchInput: {
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: C.ink,
    backgroundColor: C.paper,
    marginTop: 12,
    minHeight: 44,
  },
  listScroll: { marginTop: 8, marginBottom: 16 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    gap: 10,
  },
  listRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  listStatusMark: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.primary },
  listStatusMarkUrgent: { backgroundColor: C.urgent },
  listRowText: { flex: 1 },
  listRowTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
  listRowSub: { fontSize: 12, color: C.inkSoft, marginTop: 2 },
  listRowDist: { fontSize: 14, fontWeight: '700', color: C.primaryDark },
  listRowActions: { flexDirection: 'row', gap: 4 },
  listRowIconBtn: { paddingVertical: 8, paddingHorizontal: 8, minHeight: 40, justifyContent: 'center' },
  listRowIconText: { fontSize: 12, fontWeight: '700', color: C.primaryDark },
  listEmpty: { textAlign: 'center', color: C.inkSoft, fontSize: 14, paddingVertical: 24 },

  statsGrid: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statsCard: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: C.line,
    paddingVertical: 18,
    alignItems: 'center',
  },
  statsNumber: { fontSize: 28, fontWeight: '800', color: C.primaryDark },
  statsLabel: { fontSize: 11, color: C.inkSoft, marginTop: 4, textAlign: 'center' },

  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  languageSwitch: {
    flexDirection: 'row',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: C.line,
    padding: 3,
    gap: 3,
  },
  languageOption: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 15,
  },
  languageOptionActive: { backgroundColor: C.primary },
  languageOptionText: { fontSize: 13, fontWeight: '700', color: C.inkSoft },
  languageOptionTextActive: { color: C.surface },
});
