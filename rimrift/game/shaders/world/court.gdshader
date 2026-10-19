// RIMRIFT Harbor Point court floor: the painted overlay (lines, key, apron, logo; its alpha thinned by wear) laid over
// tiling asphalt, as court.js does with its floor material. UV = overlay (0..1 over the overlay rect), UV2 = metres/4.
shader_type spatial;
render_mode cull_back, depth_draw_opaque;

uniform sampler2D overlay : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D asphalt : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D asphalt_n : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 tint : source_color = vec3(0.847, 0.824, 0.784); // themes.js asphaltTint #d8d2c8
uniform float asphalt_rough : hint_range(0.0, 1.0) = 0.86;
uniform float paint_rough : hint_range(0.0, 1.0) = 0.62;
uniform float normal_scale : hint_range(0.0, 2.0) = 0.8;
uniform float grain : hint_range(0.0, 1.0) = 0.55; // how much of the asphalt grain shows through the paint

void fragment() {
	vec4 ov = texture(overlay, UV);
	vec3 asph = texture(asphalt, UV2).rgb;
	float lum = dot(asph, vec3(0.299, 0.587, 0.114)) / 0.24; // the asphalt's base value is ~0.24
	vec3 paint = ov.rgb * mix(1.0, clamp(lum, 0.5, 1.6), grain);
	float a = ov.a;
	ALBEDO = mix(asph * tint, paint, a);
	ROUGHNESS = mix(asphalt_rough, paint_rough, a);
	SPECULAR = mix(0.5, 0.35, a); // the paint reflects the bright sky less at grazing angles
	NORMAL_MAP = texture(asphalt_n, UV2).rgb;
	NORMAL_MAP_DEPTH = normal_scale * mix(1.0, 0.45, a);
}
