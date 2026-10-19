// RIMRIFT Harbor Point vignette: a full-screen quad drawn last in the transparent pass that multiplies the HDR frame
// (before glow and AgX, so the corners roll off like a lens, not like a black overlay). themes.js grade.vignette.
shader_type spatial;
render_mode unshaded, blend_mul, depth_test_disabled, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled, skip_vertex_transform;

uniform float strength : hint_range(0.0, 1.0) = 0.42;  // how dark the extreme corners get (0 = off)
uniform float radius : hint_range(0.0, 1.5) = 0.55;    // where the fall-off starts (0 = centre, 1 = the frame's short edge)
uniform float softness : hint_range(0.01, 1.5) = 0.75; // width of the fall-off
uniform float squeeze : hint_range(0.5, 1.0) = 0.85;   // ellipse: < 1 keeps the wide frame's left/right edges lighter

void vertex() {
	POSITION = vec4(VERTEX.xy, 1.0, 1.0); // a 2 x 2 QuadMesh in clip space (z = 1 is the near plane with reversed Z)
}

void fragment() {
	vec2 p = SCREEN_UV * 2.0 - 1.0;
	p.x *= VIEWPORT_SIZE.x / VIEWPORT_SIZE.y * squeeze;
	float d = length(p);
	float v = 1.0 - strength * smoothstep(radius, radius + softness, d);
	ALBEDO = vec3(v);
}
