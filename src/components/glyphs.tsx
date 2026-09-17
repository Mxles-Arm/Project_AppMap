import { View } from 'react-native';

type GlyphProps = {
  size?: number;
  color?: string;
};

/**
 * Geometric pin mark built from plain Views — a diamond over a stem,
 * standing in for a map-pin icon without pulling in an emoji or icon font.
 */
export function PinGlyph({ size = 20, color = '#1C1917' }: GlyphProps) {
  const head = size * 0.6;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-start' }}>
      <View
        style={{
          width: head,
          height: head,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
          borderRadius: 2,
        }}
      />
      <View
        style={{
          width: 2,
          height: size * 0.35,
          backgroundColor: color,
          marginTop: -2,
        }}
      />
    </View>
  );
}

/**
 * Restroom pictogram: two plain figures side by side — a rectangular body
 * for one, a triangular skirt-body for the other — built from Views only.
 */
export function RestroomGlyph({ size = 64, color = '#FFFFFF' }: GlyphProps) {
  const headSize = size * 0.2;
  const bodyWidth = size * 0.26;
  const bodyHeight = size * 0.42;
  const gap = size * 0.08;

  return (
    <View style={{ width: size, height: size, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap }}>
      {/* figure one: rectangular body */}
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: headSize, height: headSize, borderRadius: headSize / 2, backgroundColor: color, marginBottom: size * 0.04 }} />
        <View style={{
          width: bodyWidth,
          height: bodyHeight,
          backgroundColor: color,
          borderTopLeftRadius: bodyWidth * 0.3,
          borderTopRightRadius: bodyWidth * 0.3,
          borderBottomLeftRadius: bodyWidth * 0.12,
          borderBottomRightRadius: bodyWidth * 0.12,
        }} />
      </View>
      {/* figure two: triangular skirt body */}
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: headSize, height: headSize, borderRadius: headSize / 2, backgroundColor: color, marginBottom: size * 0.04 }} />
        <View style={{
          width: 0,
          height: 0,
          borderLeftWidth: bodyWidth * 0.65,
          borderRightWidth: bodyWidth * 0.65,
          borderTopWidth: bodyHeight,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
          borderRadius: 4,
        }} />
      </View>
    </View>
  );
}

/**
 * Two-figure accessibility mark: a head-circle over a body-bar, doubled,
 * standing in for a wheelchair/accessible glyph without an emoji.
 */
export function AccessibleGlyph({ size = 16, color = '#1C1917' }: GlyphProps) {
  const headSize = size * 0.32;
  const bodyWidth = size * 0.5;
  const bodyHeight = size * 0.4;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: headSize,
          height: headSize,
          borderRadius: headSize / 2,
          backgroundColor: color,
          marginBottom: 1,
        }}
      />
      <View
        style={{
          width: bodyWidth,
          height: bodyHeight,
          borderWidth: 1.5,
          borderColor: color,
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
          borderBottomLeftRadius: bodyHeight,
          borderBottomRightRadius: bodyHeight,
        }}
      />
    </View>
  );
}
