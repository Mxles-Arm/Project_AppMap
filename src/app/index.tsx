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

const STATUS_LABEL: Record<ToiletStatus, string> = {
  available: 'ใช้งานได้',
  closed: 'ปิดซ่อม',
  no_paper: 'ไม่มีกระดาษ',
};

const STATUS_COLOR: Record<ToiletStatus, string> = {
  available: '#16A34A',
  closed: '#DC2626',
  no_paper: '#D97706',
};

const KMUTNB = { latitude: 13.819552, longitude: 100.514812 };
const DELTA = { latitudeDelta: 0.005, longitudeDelta: 0.005 };

// Design system: Flat Design Mobile (Touch-First) + Medical Teal palette (UIUX-Pro)
const C = {
  primary: '#0891B2',
  primaryDark: '#0E7490',
  accent: '#16A34A',
  urgent: '#DC2626',
  accessible: '#7C3AED',
  bg: '#F0FDFA',
  surface: '#FFFFFF',
  muted: '#E6F7F5',
  border: '#CCFBF1',
  text: '#134E4A',
  textMuted: '#64748B',
};

export default function Index() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const { location } = useLocation();

  const [toilets, setToilets] = useState<Toilet[]>([]);
  const [nearest, setNearest] = useState<{ toilet: Toilet; distance: number; skippedClosed?: boolean } | null>(null);
  const [route, setRoute] = useState<{ latitude: number; longitude: number }[] | null>(null);
  const [walkInfo, setWalkInfo] = useState<{ distanceMeters: number; durationSeconds: number } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [listVisible, setListVisible] = useState(false);
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stats, setStats] = useState<ContributionStats>({ added: 0, confirmed: 0, statusUpdated: 0 });
  const [statsVisible, setStatsVisible] = useState(false);

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

  async function loadToilets() {
    const data = await getAll();
    setToilets(data);
  }

  function handleFindNearest() {
    if (!location) {
      Alert.alert('ยังไม่ได้รับตำแหน่ง', 'กรุณารอสักครู่แล้วลองใหม่');
      return;
    }
    if (toilets.length === 0) {
      Alert.alert('ยังไม่มีข้อมูลห้องน้ำ', 'กดปุ่ม + เพื่อเพิ่มจุดห้องน้ำก่อน');
      return;
    }
    const result = findNearest(toilets, location);
    if (!result) return;
    setNearest(result);
    mapRef.current?.animateToRegion({
      latitude: result.toilet.latitude,
      longitude: result.toilet.longitude,
      ...DELTA,
    }, 600);
  }

  function openModal() {
    if (!location) {
      Alert.alert('ยังไม่ได้รับตำแหน่ง', 'กรุณารอให้แอปรับตำแหน่งก่อน');
      return;
    }
    setEditingId(null);
    setBuilding('');
    setFloor('');
    setAccessible(false);
    setModalVisible(true);
  }

  function openEditModal(t: Toilet) {
    setListVisible(false);
    setEditingId(t.id);
    setBuilding(t.building);
    setFloor(t.floor);
    setAccessible(t.accessible === 1);
    setModalVisible(true);
  }

  async function handleSave() {
    if (!building.trim()) {
      Alert.alert('กรุณากรอกชื่ออาคาร');
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
        if (!location) return;
        await insert({
          building: building.trim(),
          floor: floor.trim(),
          accessible: accessible ? 1 : 0,
          latitude: location.latitude,
          longitude: location.longitude,
        });
        setStats(await recordAdded());
      }
      await loadToilets();
      setNearest(null);
      setModalVisible(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number, name: string) {
    Alert.alert(
      'ลบห้องน้ำ',
      `ต้องการลบ "${name}" ออกจากแผนที่?`,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบ',
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
      Alert.alert('ยังไม่ได้รับตำแหน่ง', 'กรุณารอสักครู่แล้วลองใหม่');
      return;
    }
    const pool = accessibleOnlyMode ? toilets.filter(t => t.accessible === 1) : toilets;
    if (pool.length === 0) {
      Alert.alert(
        accessibleOnlyMode ? 'ยังไม่มีข้อมูลห้องน้ำผู้พิการ' : 'ยังไม่มีข้อมูลห้องน้ำ',
        'กดปุ่ม + เพื่อเพิ่มจุดห้องน้ำก่อน'
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
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.headerMain}
            onPress={() => setListVisible(true)}
            activeOpacity={0.7}
            disabled={toilets.length === 0}
          >
            <View>
              <Text style={styles.headerTitle}>LooMap</Text>
              <Text style={styles.headerSub}>
                {toilets.length > 0
                  ? `${toilets.length} จุด · แตะเพื่อดูรายการ`
                  : location ? 'ยังไม่มีข้อมูล — กด + เพื่อเริ่ม' : 'กำลังหาตำแหน่ง…'}
              </Text>
            </View>
            {toilets.length > 0 && <Text style={styles.headerChevron}>›</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.statsBtn}
            onPress={() => setStatsVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.statsBtnText}>คุณ</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={openModal}
            activeOpacity={0.7}
          >
            <Text style={styles.addBtnText}>+ เพิ่มจุด</Text>
          </TouchableOpacity>
        </View>

        {/* Legend */}
        {toilets.length > 0 && (
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: C.primary }]} />
              <Text style={styles.legendText}>ทั่วไป</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: C.accessible }]} />
              <Text style={styles.legendText}>♿ ผู้พิการ</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: STATUS_COLOR.closed }]} />
              <Text style={styles.legendText}>ปิดซ่อม</Text>
            </View>
          </View>
        )}
      </View>

      {/* Map */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{ ...KMUTNB, ...DELTA }}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {toilets.map(t => (
          <Marker
            key={t.id}
            coordinate={{ latitude: t.latitude, longitude: t.longitude }}
            pinColor={t.status !== 'available' ? STATUS_COLOR[t.status] : (t.accessible ? C.accessible : C.primary)}
            onPress={() => focusToilet(t)}
          />
        ))}
        {route && (
          <Polyline coordinates={route} strokeColor={C.primary} strokeWidth={4} />
        )}
      </MapView>

      {/* Recenter button */}
      <TouchableOpacity
        style={styles.recenterBtn}
        onPress={recenter}
        activeOpacity={0.85}
      >
        <Text style={styles.recenterIcon}>◎</Text>
      </TouchableOpacity>

      {/* Result card */}
      {nearest && (
        <View style={[styles.resultCard, { bottom: insets.bottom + 156 }]}>
          <View style={styles.resultSection}>
            <View style={styles.resultTitleRow}>
              <Text style={styles.resultBuilding} numberOfLines={1}>
                {nearest.toilet.building}
                {nearest.toilet.floor ? ` · ${nearest.toilet.floor}` : ''}
              </Text>
              <TouchableOpacity
                style={styles.resultCloseBtn}
                onPress={() => setNearest(null)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.resultCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {nearest.toilet.accessible === 1 && (
              <Text style={styles.resultAccessible}>♿ มีห้องน้ำผู้พิการ</Text>
            )}

            {routeLoading ? (
              <Text style={styles.resultWalkLoading}>กำลังคำนวณเส้นทาง…</Text>
            ) : walkInfo ? (
              <Text style={styles.resultDistance}>
                เดิน {formatDuration(walkInfo.durationSeconds)} · {formatDistance(walkInfo.distanceMeters)}
              </Text>
            ) : (
              <Text style={styles.resultDistance}>{formatDistance(nearest.distance)}</Text>
            )}
          </View>

          <View style={styles.resultDivider} />

          <View style={styles.resultSection}>
            <Text style={styles.resultSectionLabel}>สถานะตอนนี้</Text>
            <View style={styles.statusRow}>
              {(['available', 'closed', 'no_paper'] as ToiletStatus[]).map(s => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.statusChip,
                    nearest.toilet.status === s && { backgroundColor: STATUS_COLOR[s], borderColor: STATUS_COLOR[s] },
                  ]}
                  onPress={() => handleSetStatus(nearest.toilet.id, s)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.statusChipText, nearest.toilet.status === s && { color: '#FFF' }]}>
                    {STATUS_LABEL[s]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.updatedRow}>
              <Text style={styles.updatedText}>อัปเดต {formatRelativeTime(nearest.toilet.updated_at)}</Text>
              <TouchableOpacity onPress={() => handleConfirm(nearest.toilet.id)} activeOpacity={0.7}>
                <Text style={styles.confirmText}>ยืนยันว่ายังถูกต้อง</Text>
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
              <Text style={styles.resultNavText}>นำทาง</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.resultDeleteBtn}
              onPress={() => handleDelete(nearest.toilet.id, `${nearest.toilet.building} ${nearest.toilet.floor}`)}
              activeOpacity={0.85}
            >
              <Text style={styles.resultDeleteText}>ลบจุดนี้</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Bottom controls */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 14 }]}>
        <TouchableOpacity style={styles.btnFind} onPress={handleFindNearest} activeOpacity={0.9}>
          <Text style={styles.btnFindText}>หาห้องน้ำใกล้สุด</Text>
        </TouchableOpacity>

        <View style={styles.urgentRow}>
          <TouchableOpacity
            style={styles.btnUrgent}
            onPress={() => handleUrgentMode(false)}
            activeOpacity={0.85}
          >
            <Text style={styles.btnUrgentText}>เร่งด่วน — นำทางทันที</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnUrgentAccessible}
            onPress={() => handleUrgentMode(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.btnUrgentAccessibleText}>♿</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Add Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{editingId !== null ? 'แก้ไขห้องน้ำ' : 'เพิ่มห้องน้ำ'}</Text>
            <Text style={styles.modalSub}>
              {editingId !== null ? 'แก้ไขข้อมูลอาคาร/ชั้น (พิกัดเดิมไม่เปลี่ยน)' : 'พิกัดดึงจากตำแหน่งปัจจุบันของคุณอัตโนมัติ'}
            </Text>

            <Text style={styles.fieldLabel}>ชื่ออาคาร *</Text>
            <TextInput
              style={styles.input}
              placeholder="เช่น อาคาร 44"
              placeholderTextColor={C.textMuted}
              value={building}
              onChangeText={setBuilding}
            />

            <Text style={styles.fieldLabel}>ชั้น</Text>
            <TextInput
              style={styles.input}
              placeholder="เช่น ชั้น 2"
              placeholderTextColor={C.textMuted}
              value={floor}
              onChangeText={setFloor}
            />

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>♿ ห้องน้ำผู้พิการ</Text>
              <Switch
                value={accessible}
                onValueChange={setAccessible}
                trackColor={{ false: C.border, true: C.accessible }}
                thumbColor={C.surface}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.btnCancel}
                onPress={() => setModalVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.btnCancelText}>ยกเลิก</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnSave, saving && styles.btnDisabled]}
                onPress={handleSave}
                activeOpacity={0.85}
                disabled={saving}
              >
                <Text style={styles.btnSaveText}>
                  {saving ? 'กำลังบันทึก…' : editingId !== null ? 'บันทึกการแก้ไข' : 'บันทึก'}
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
              <Text style={styles.modalTitle}>รายการห้องน้ำ ({sortedFilteredToilets.length})</Text>
              <TouchableOpacity
                style={[styles.filterChip, accessibleOnly && styles.filterChipActive]}
                onPress={() => setAccessibleOnly(v => !v)}
                activeOpacity={0.8}
              >
                <Text style={[styles.filterChipText, accessibleOnly && styles.filterChipTextActive]}>
                  ♿ เฉพาะผู้พิการ
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="ค้นหาอาคาร/ชั้น เช่น อาคาร 44"
              placeholderTextColor={C.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <Text style={styles.modalSub}>เรียงจากใกล้ไปไกล</Text>
            <ScrollView style={styles.listScroll}>
              {sortedFilteredToilets.map(t => {
                const dist = location
                  ? haversine(location.latitude, location.longitude, t.latitude, t.longitude)
                  : null;
                return (
                  <View key={t.id} style={styles.listRow}>
                    <TouchableOpacity
                      style={styles.listRowMain}
                      onPress={() => focusToilet(t)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.legendDot, { backgroundColor: STATUS_COLOR[t.status] }]} />
                      <View style={styles.listRowText}>
                        <Text style={styles.listRowTitle}>
                          {t.building}{t.floor ? ` · ${t.floor}` : ''}
                        </Text>
                        <Text style={styles.listRowSub}>
                          {t.accessible === 1 ? '♿ ผู้พิการ · ' : ''}{STATUS_LABEL[t.status]} · {formatRelativeTime(t.updated_at)}
                        </Text>
                      </View>
                      {dist !== null && (
                        <Text style={styles.listRowDist}>{formatDistance(dist)}</Text>
                      )}
                    </TouchableOpacity>
                    <View style={styles.listRowActions}>
                      <TouchableOpacity onPress={() => navigateTo(t)} activeOpacity={0.7} style={styles.listRowIconBtn}>
                        <Text style={styles.listRowIconText}>นำทาง</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => openEditModal(t)} activeOpacity={0.7} style={styles.listRowIconBtn}>
                        <Text style={styles.listRowIconText}>แก้ไข</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
              {sortedFilteredToilets.length === 0 && (
                <Text style={styles.listEmpty}>ไม่พบห้องน้ำที่ตรงเงื่อนไข</Text>
              )}
            </ScrollView>
            <TouchableOpacity
              style={styles.btnCancel}
              onPress={() => setListVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnCancelText}>ปิด</Text>
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
            <Text style={styles.modalTitle}>สิ่งที่คุณช่วยเหลือ</Text>
            <Text style={styles.modalSub}>ขอบคุณที่ช่วยกันทำให้ข้อมูลในแอปเป็นประโยชน์กับทุกคน</Text>

            <View style={styles.statsGrid}>
              <View style={styles.statsCard}>
                <Text style={styles.statsNumber}>{stats.added}</Text>
                <Text style={styles.statsLabel}>จุดที่เพิ่ม</Text>
              </View>
              <View style={styles.statsCard}>
                <Text style={styles.statsNumber}>{stats.confirmed}</Text>
                <Text style={styles.statsLabel}>ครั้งที่ยืนยัน</Text>
              </View>
              <View style={styles.statsCard}>
                <Text style={styles.statsNumber}>{stats.statusUpdated}</Text>
                <Text style={styles.statsLabel}>อัปเดตสถานะ</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.btnCancel}
              onPress={() => setStatsVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnCancelText}>ปิด</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  headerSub: { fontSize: 13, color: C.textMuted, marginTop: 2, fontWeight: '400' },
  headerChevron: { fontSize: 20, color: C.primary, fontWeight: '700' },
  statsBtn: {
    minWidth: 48,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  statsBtnText: { fontSize: 12, fontWeight: '700', color: C.text },
  addBtn: {
    minWidth: 48,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  addBtnText: { fontSize: 12, fontWeight: '700', color: '#FFF' },

  legend: {
    marginTop: 12,
    backgroundColor: C.muted,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    gap: 14,
    alignSelf: 'flex-start',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 11, color: C.text, fontWeight: '600' },

  map: { flex: 1 },

  recenterBtn: {
    position: 'absolute',
    top: '45%',
    right: 12,
    zIndex: 10,
    elevation: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  recenterIcon: { fontSize: 20, color: C.primary },

  resultCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  resultSection: { padding: 16 },
  resultDivider: { height: 1, backgroundColor: C.border },
  resultSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  resultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultBuilding: { flex: 1, fontSize: 17, fontWeight: '800', color: C.text },
  resultCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultCloseText: { fontSize: 13, fontWeight: '700', color: C.textMuted },
  resultAccessible: { fontSize: 12, color: C.accessible, marginTop: 6, fontWeight: '600' },
  resultDistance: { fontSize: 16, fontWeight: '700', color: C.primaryDark, marginTop: 6 },
  resultWalkLoading: { fontSize: 13, color: C.textMuted, marginTop: 6 },
  statusRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statusChip: {
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  statusChipText: { fontSize: 12, fontWeight: '700', color: C.textMuted },
  updatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    gap: 8,
  },
  updatedText: { fontSize: 12, color: C.textMuted },
  confirmText: { fontSize: 12, color: C.primary, fontWeight: '700' },
  resultCardActions: { flexDirection: 'row', gap: 10, padding: 16 },
  resultNavBtn: {
    flex: 1,
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultNavText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  resultDeleteBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: C.urgent,
    borderRadius: 10,
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
    borderTopColor: C.border,
    gap: 10,
  },
  btnFind: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 17,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFindText: { color: '#FFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  urgentRow: { flexDirection: 'row', gap: 10 },
  btnUrgent: {
    flex: 1,
    backgroundColor: C.urgent,
    borderRadius: 12,
    paddingVertical: 13,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnUrgentText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  btnUrgentAccessible: {
    width: 56,
    minHeight: 48,
    backgroundColor: C.accessible,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnUrgentAccessibleText: { fontSize: 20 },

  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,23,0.45)',
  },
  modalSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 32,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 4 },
  modalSub: { fontSize: 13, color: C.textMuted, marginBottom: 20 },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: C.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: {
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: C.text,
    backgroundColor: C.muted,
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
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancelText: { fontSize: 15, fontWeight: '700', color: C.textMuted },
  btnSave: {
    flex: 2,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSaveText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  btnDisabled: { opacity: 0.6 },

  listSheet: { maxHeight: '80%' },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  filterChip: {
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 12,
    minHeight: 32,
  },
  filterChipActive: { backgroundColor: C.accessible, borderColor: C.accessible },
  filterChipText: { fontSize: 12, fontWeight: '700', color: C.textMuted },
  filterChipTextActive: { color: '#FFF' },
  searchInput: {
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: C.text,
    backgroundColor: C.muted,
    marginTop: 12,
    minHeight: 44,
  },
  listScroll: { marginTop: 8, marginBottom: 16 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  listRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  listRowText: { flex: 1 },
  listRowTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  listRowSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  listRowDist: { fontSize: 14, fontWeight: '700', color: C.primaryDark },
  listRowActions: { flexDirection: 'row', gap: 4 },
  listRowIconBtn: { paddingVertical: 8, paddingHorizontal: 8, minHeight: 40, justifyContent: 'center' },
  listRowIconText: { fontSize: 12, fontWeight: '700', color: C.primary },
  listEmpty: { textAlign: 'center', color: C.textMuted, fontSize: 14, paddingVertical: 24 },

  statsGrid: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statsCard: {
    flex: 1,
    backgroundColor: C.muted,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  statsNumber: { fontSize: 28, fontWeight: '800', color: C.primary },
  statsLabel: { fontSize: 12, color: C.textMuted, marginTop: 4, textAlign: 'center' },
});
