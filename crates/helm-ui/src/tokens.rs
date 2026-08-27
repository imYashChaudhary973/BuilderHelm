use iced::{Color, Vector};

pub const fn rgb(hex: u32) -> Color {
    Color {
        r: ((hex >> 16) & 0xff) as f32 / 255.0,
        g: ((hex >> 8) & 0xff) as f32 / 255.0,
        b: (hex & 0xff) as f32 / 255.0,
        a: 1.0,
    }
}

pub const fn rgba(r: u8, g: u8, b: u8, a: f32) -> Color {
    Color {
        r: r as f32 / 255.0,
        g: g as f32 / 255.0,
        b: b as f32 / 255.0,
        a,
    }
}

pub const BG: Color = rgb(0x080a07);
pub const BG_1: Color = rgb(0x0d100a);
pub const PANEL: Color = rgb(0x11150d);
pub const GLASS: Color = rgba(20, 24, 16, 0.55);
pub const GLASS_STRONG: Color = rgba(26, 30, 20, 0.78);
pub const LINE: Color = rgba(255, 255, 255, 0.07);
pub const LINE_STRONG: Color = rgba(255, 255, 255, 0.13);
pub const TEXT: Color = rgb(0xeef1e4);
pub const TEXT_2: Color = rgb(0xa8b09c);
pub const TEXT_3: Color = rgb(0x6f7767);
pub const ACCENT: Color = rgb(0xb6d475);
pub const ACCENT_BRIGHT: Color = rgb(0xd3ef9c);
pub const ACCENT_DIM: Color = rgba(182, 212, 117, 0.12);
pub const ACCENT_LINE: Color = rgba(182, 212, 117, 0.35);
pub const DANGER: Color = rgb(0xff8f73);
pub const DANGER_DIM: Color = rgba(255, 143, 115, 0.12);
pub const WARNING: Color = rgb(0xf2c94c);

pub const RADIUS_S: f32 = 10.0;
pub const RADIUS_M: f32 = 14.0;
pub const RADIUS_L: f32 = 18.0;

/// CSS has no `--space-*` tokens. Chrome uses these sizes next to the radii.
pub const SPACE_PAD: f32 = 3.0;
pub const SPACE_GAP: f32 = 4.0;

pub const FONT_MONO: &str = "ui-monospace, SFMono-Regular, Menlo, monospace";
pub const FONT_SANS: &str =
    "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CubicBezier {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
}

pub const EASE_OUT: CubicBezier = CubicBezier {
    x1: 0.22,
    y1: 1.0,
    x2: 0.36,
    y2: 1.0,
};
pub const EASE_3D: CubicBezier = CubicBezier {
    x1: 0.32,
    y1: 0.72,
    x2: 0.0,
    y2: 1.0,
};

pub fn ease(t: f32, curve: CubicBezier) -> f32 {
    cubic_bezier(t.clamp(0.0, 1.0), curve.x1, curve.y1, curve.x2, curve.y2)
}

fn cubic_bezier(t: f32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
    let mut lo = 0.0;
    let mut hi = 1.0;
    let mut mid = t;
    for _ in 0..16 {
        let x = sample(mid, x1, x2);
        if (x - t).abs() < 1e-4 {
            break;
        }
        if x < t {
            lo = mid;
        } else {
            hi = mid;
        }
        mid = (lo + hi) * 0.5;
    }
    sample(mid, y1, y2)
}

fn sample(t: f32, a: f32, b: f32) -> f32 {
    let u = 1.0 - t;
    3.0 * u * u * t * a + 3.0 * u * t * t * b + t * t * t
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShadowLayer {
    pub inset: bool,
    pub offset: Vector,
    pub blur: f32,
    pub color: Color,
}

pub const SHADOW_CARD: &[ShadowLayer] = &[
    ShadowLayer {
        inset: true,
        offset: Vector::new(0.0, 1.0),
        blur: 0.0,
        color: rgba(255, 255, 255, 0.03),
    },
    ShadowLayer {
        inset: false,
        offset: Vector::new(0.0, 24.0),
        blur: 48.0,
        color: rgba(0, 0, 0, 0.55),
    },
];

pub const SHADOW_FLOAT: ShadowLayer = ShadowLayer {
    inset: false,
    offset: Vector::new(0.0, 20.0),
    blur: 60.0,
    color: rgba(0, 0, 0, 0.65),
};

pub const BEVEL_3D: &[ShadowLayer] = &[
    ShadowLayer {
        inset: false,
        offset: Vector::new(0.0, 1.0),
        blur: 1.0,
        color: rgba(0, 0, 0, 0.35),
    },
    ShadowLayer {
        inset: false,
        offset: Vector::new(0.0, 3.0),
        blur: 6.0,
        color: rgba(0, 0, 0, 0.28),
    },
    ShadowLayer {
        inset: false,
        offset: Vector::new(0.0, 8.0),
        blur: 16.0,
        color: rgba(0, 0, 0, 0.22),
    },
    ShadowLayer {
        inset: true,
        offset: Vector::new(0.0, 1.0),
        blur: 2.0,
        color: rgba(255, 255, 255, 0.14),
    },
    ShadowLayer {
        inset: true,
        offset: Vector::new(0.0, -3.0),
        blur: 6.0,
        color: rgba(0, 0, 0, 0.55),
    },
];

pub const BEVEL_3D_PRESSED: &[ShadowLayer] = &[
    ShadowLayer {
        inset: false,
        offset: Vector::new(0.0, 1.0),
        blur: 2.0,
        color: rgba(0, 0, 0, 0.25),
    },
    ShadowLayer {
        inset: true,
        offset: Vector::new(0.0, 2.0),
        blur: 6.0,
        color: rgba(0, 0, 0, 0.55),
    },
    ShadowLayer {
        inset: true,
        offset: Vector::new(0.0, -1.0),
        blur: 1.0,
        color: rgba(255, 255, 255, 0.06),
    },
];

pub const BEVEL_INSET: &[ShadowLayer] = &[
    ShadowLayer {
        inset: true,
        offset: Vector::new(0.0, 2.0),
        blur: 5.0,
        color: rgba(0, 0, 0, 0.55),
    },
    ShadowLayer {
        inset: true,
        offset: Vector::new(0.0, -1.0),
        blur: 1.0,
        color: rgba(255, 255, 255, 0.08),
    },
];

pub fn outer_drop(layer: ShadowLayer) -> iced::Shadow {
    iced::Shadow {
        color: layer.color,
        offset: layer.offset,
        blur_radius: layer.blur,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours_match_css_hex() {
        assert_eq!(BG, rgb(0x080a07));
        assert_eq!(BG_1, rgb(0x0d100a));
        assert_eq!(PANEL, rgb(0x11150d));
        assert_eq!(TEXT, rgb(0xeef1e4));
        assert_eq!(TEXT_2, rgb(0xa8b09c));
        assert_eq!(TEXT_3, rgb(0x6f7767));
        assert_eq!(ACCENT, rgb(0xb6d475));
        assert_eq!(ACCENT_BRIGHT, rgb(0xd3ef9c));
        assert_eq!(DANGER, rgb(0xff8f73));
        assert_eq!(WARNING, rgb(0xf2c94c));
        assert!((GLASS.a - 0.55).abs() < f32::EPSILON);
        assert!((ACCENT_LINE.a - 0.35).abs() < f32::EPSILON);
    }

    #[test]
    fn radii_easings_and_bevel_layers_match_css() {
        assert_eq!([RADIUS_S, RADIUS_M, RADIUS_L], [10.0, 14.0, 18.0]);
        assert_eq!(
            EASE_OUT,
            CubicBezier {
                x1: 0.22,
                y1: 1.0,
                x2: 0.36,
                y2: 1.0
            }
        );
        assert_eq!(
            EASE_3D,
            CubicBezier {
                x1: 0.32,
                y1: 0.72,
                x2: 0.0,
                y2: 1.0
            }
        );
        assert_eq!(BEVEL_3D.len(), 5);
        assert_eq!(BEVEL_3D.iter().filter(|l| l.inset).count(), 2);
        assert_eq!(BEVEL_3D_PRESSED.len(), 3);
        assert_eq!(BEVEL_INSET.len(), 2);
        assert!(BEVEL_INSET.iter().all(|l| l.inset));
        assert_eq!(SHADOW_FLOAT.blur, 60.0);
        assert_eq!(ease(0.0, EASE_OUT), 0.0);
        assert!((ease(1.0, EASE_OUT) - 1.0).abs() < 0.02);
    }
}
