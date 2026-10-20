// RIMRIFT Harbor Point sunset sky. themes.js gives three colours (top / horizon / ground); the look pass against the
// concept art adds an amber band above the horizon (the poster camera sees only the lowest ~10° of sky, so the
// zenith blue must not leak into the frame), a dusky horizon away from the sun, a wide hot corridor around the
// sun on the waterline, and the disc. The disc and glow are dimmed in the cubemap (radiance) pass so the ambient
// light is the dim sky, not the sun's corona.
shader_type sky;
render_mode use_debanding;

uniform vec3 top_color : source_color = vec3(0.30, 0.36, 0.50);      // zenith: dim desaturated blue-grey (out of the poster frame)
uniform vec3 upper_color : source_color = vec3(0.50, 0.24, 0.12);    // 6..25° up: the deep amber-brown band of the target
uniform vec3 horizon_color : source_color = vec3(1.0, 0.50, 0.16);   // the horizon under the sun: saturated orange
uniform vec3 horizon_away : source_color = vec3(0.60, 0.40, 0.40);   // the horizon opposite the sun: dusky pink
uniform vec3 upper_away : source_color = vec3(0.40, 0.30, 0.42);     // look pass 3: the band opposite the sun goes lavender (the Belt of Venus), not brown — the close/baseline cameras look this way and it is what fills the athletes' shadow side
uniform vec3 ground_color : source_color = vec3(0.35, 0.25, 0.2);
uniform vec3 ground_horizon : source_color = vec3(0.55, 0.36, 0.28);
uniform vec3 sun_dir = vec3(-0.24, 0.05, 0.97);
uniform vec3 sun_color : source_color = vec3(1.0, 0.84, 0.50);
uniform float band_height = 0.10;      // sin(elevation) where the horizon colour has given way to the upper band (~6°)
uniform float upper_height = 0.55;     // sin(elevation) where the upper band has given way to the zenith (~33°)
uniform float sun_size_deg = 2.2;      // apparent diameter (the real sun is 0.53°; bigger reads as the poster)
uniform float sun_energy = 14.0;       // HDR value of the disc (AgX rolls it off)
uniform float glow_energy = 2.2;       // the corona
uniform float corridor_energy = 1.5;   // the wide hot band along the horizon around the sun
uniform float radiance_sun = 0.08;     // sun disc + glow scale in the cubemap pass (ambient / reflections)

void sky() {
	vec3 d = EYEDIR;
	vec3 s = normalize(sun_dir);
	float up = clamp(d.y, 0.0, 1.0);
	float cosang = dot(d, s);
	// how far round the horizon we are from the sun (1 = under it, 0 = opposite)
	vec2 dh = normalize(d.xz + vec2(1e-5, 0.0)), sh = normalize(s.xz);
	float toward = dot(dh, sh) * 0.5 + 0.5;
	vec3 hor = mix(horizon_away, horizon_color, pow(toward, 1.6));
	vec3 upper = mix(upper_away, upper_color, pow(toward, 1.2));
	vec3 col;
	if (d.y >= 0.0) {
		col = mix(hor, upper, smoothstep(0.0, band_height, up));
		col = mix(col, top_color, smoothstep(band_height * 0.8, upper_height, up));
	} else {
		col = mix(mix(ground_horizon, hor, 0.5), ground_color, clamp(-d.y * 6.0, 0.0, 1.0));
	}
	// the hot corridor: wide around the sun, hugging the horizon
	float low = exp(-up * 9.0);
	col += sun_color * corridor_energy * pow(max(cosang, 0.0), 9.0) * low * (d.y >= 0.0 ? 1.0 : 0.5);
	// corona + disc
	float k = AT_CUBEMAP_PASS ? radiance_sun : 1.0;
	float glow = pow(max(cosang, 0.0), 30.0) * 0.15 + pow(max(cosang, 0.0), 200.0) * 0.5 + pow(max(cosang, 0.0), 1200.0) * 1.0;
	col += sun_color * glow * glow_energy * k;
	float r = radians(sun_size_deg * 0.5);
	float disc = smoothstep(cos(r * 1.25), cos(r), cosang);
	col += sun_color * disc * sun_energy * k * (d.y >= -0.002 ? 1.0 : 0.0);
	COLOR = col;
}
