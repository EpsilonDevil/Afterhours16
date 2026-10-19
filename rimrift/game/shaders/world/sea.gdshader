// RIMRIFT Harbor Point sea: two crossing swell layers of one tiling normal map scrolling against each other
// (venues.js coastScenery seaMat / seaMat2), a deep teal base, a fresnel toward the horizon and a sun-glitter term.
shader_type spatial;
render_mode cull_back, depth_draw_opaque, specular_schlick_ggx;

uniform sampler2D normal_map : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 color : source_color = vec3(0.082, 0.337, 0.431);   // #15566e
uniform vec3 color2 : source_color = vec3(0.169, 0.498, 0.573);  // #2b7f92
uniform vec3 horizon : source_color = vec3(0.62, 0.52, 0.46);    // the haze the far water takes on
uniform float tiles1 = 59.5;   // 34 * 700/400 tiles across the 700 m plane
uniform float tiles2 = 33.25;  // 19 * 700/400
uniform float strength1 = 0.65;
uniform float strength2 = 0.5;
uniform float roughness : hint_range(0.0, 1.0) = 0.12;
uniform float glitter = 1.0;
uniform vec3 sun_dir = vec3(-0.75, 0.32, 0.55);

void fragment() {
	vec2 uv1 = UV * vec2(tiles1, tiles1 * 160.0 / 700.0) + TIME * vec2(0.016, 0.03);
	vec2 uv2 = UV * vec2(tiles2, tiles2 * 160.0 / 700.0) + TIME * vec2(-0.026, 0.018);
	vec3 n1 = texture(normal_map, uv1).rgb * 2.0 - 1.0;
	vec3 n2 = texture(normal_map, uv2).rgb * 2.0 - 1.0;
	vec3 n = normalize(vec3(n1.xy * strength1 + n2.xy * strength2, 1.0));
	NORMAL_MAP = n * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = 1.0;
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	ALBEDO = mix(mix(color, color2, 0.3) * 0.8, horizon, fres * 0.3);
	ROUGHNESS = roughness;
	METALLIC = 0.05;
	SPECULAR = 1.0;
	// sun glitter: a tight lobe of the perturbed normal toward the half vector of the sun (world space)
	vec3 wn = normalize(mat3(INV_VIEW_MATRIX) * normalize(TANGENT * n.x + BINORMAL * n.y + NORMAL * n.z));
	vec3 wv = normalize(mat3(INV_VIEW_MATRIX) * VIEW);
	vec3 h = normalize(normalize(sun_dir) + wv);
	float spec = pow(max(dot(wn, h), 0.0), 900.0);
	EMISSION = vec3(1.0, 0.72, 0.45) * spec * glitter * 4.0;
}
