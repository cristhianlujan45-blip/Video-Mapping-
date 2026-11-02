// testplugin.cpp — plugins FFGL de prueba REALES (no simulados) para las pruebas automáticas.
// Se compilan desde este mismo archivo, escritos según la especificación FFGL:
//   LUMA_KIND=0  «LumaTest Fuente»  fuente FFGL 2.1: degradado con Brillo, Rojo, Modo, Escala y Etiqueta
//   LUMA_KIND=1  «LumaTest Efecto»  efecto FFGL 2.1: invierte los colores de la entrada (Invertir, Mezcla)
//   LUMA_KIND=2  «LumaTest FFGL 1» fuente FFGL 1.6: color liso con OpenGL clásico (glBegin)
// Variables de entorno solo para probar el aislamiento: LUMATEST_CRASH=1 (se cae al dibujar)
// y LUMATEST_HANG=1 (se cuelga al dibujar).
#include "ffgl_defs.h"
#include "glmini.h"

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <string>

#if !defined( _WIN32 )
#include <dlfcn.h>
#include <unistd.h>
#endif

#ifndef LUMA_KIND
#define LUMA_KIND 0
#endif

/* --------------------------------------------------- Datos del plugin */
#if LUMA_KIND == 0
static PluginInfoStruct s_info = { 2, 1, { 'L', 'T', 'S', 'R' }, "LumaTest Fuente", FF_SOURCE };
enum { P_BRILLO, P_ROJO, P_MODO, P_ESCALA, P_ETIQUETA, NPARAMS };
static const char* s_names[ NPARAMS ]   = { "Brillo", "Rojo", "Modo", "Escala", "Etiqueta" };
static const FFUInt32 s_types[ NPARAMS ] = { FF_TYPE_STANDARD, FF_TYPE_RED, FF_TYPE_OPTION, FF_TYPE_INTEGER, FF_TYPE_TEXT };
static const float s_defs[ NPARAMS ]    = { 1.0f, 1.0f, 0.0f, 1.0f, 0.0f };
static const float s_mins[ NPARAMS ]    = { 0, 0, 0, 1, 0 };
static const float s_maxs[ NPARAMS ]    = { 1, 1, 1, 8, 1 };
static const char* s_options[]          = { "Degradado", "Liso" };
#elif LUMA_KIND == 1
static PluginInfoStruct s_info = { 2, 1, { 'L', 'T', 'E', 'F' }, "LumaTest Efecto", FF_EFFECT };
enum { P_INVERTIR, P_MEZCLA, NPARAMS };
static const char* s_names[ NPARAMS ]   = { "Invertir", "Mezcla" };
static const FFUInt32 s_types[ NPARAMS ] = { FF_TYPE_BOOLEAN, FF_TYPE_STANDARD };
static const float s_defs[ NPARAMS ]    = { 1.0f, 1.0f };
static const float s_mins[ NPARAMS ]    = { 0, 0 };
static const float s_maxs[ NPARAMS ]    = { 1, 1 };
static const char* s_options[]          = { "" };
#else
static PluginInfoStruct s_info = { 1, 6, { 'L', 'T', 'C', 'L' }, "LumaTest FFGL 1", FF_SOURCE };
enum { P_VERDE, NPARAMS };
static const char* s_names[ NPARAMS ]   = { "Verde" };
static const FFUInt32 s_types[ NPARAMS ] = { FF_TYPE_STANDARD };
static const float s_defs[ NPARAMS ]    = { 1.0f };
static const float s_mins[ NPARAMS ]    = { 0 };
static const float s_maxs[ NPARAMS ]    = { 1 };
static const char* s_options[]          = { "" };
#endif
static PluginExtendedInfoStruct s_ext = { 1, 0, "Plugin de prueba de LumaMap", "LumaMap (pruebas automáticas)", 0, NULL };
static const char* s_defText          = "hola";

/* ------------------------------------------------ Funciones de OpenGL */
#if !defined( _WIN32 )
// Linux (solo pruebas): OSMesa del anfitrión si está cargada; si no, libGL.
static void* plugGetProc( const char* n )
{
	static LumaGetProc osm = (LumaGetProc)dlsym( RTLD_DEFAULT, "OSMesaGetProcAddress" );
	if( osm ) return osm( n );
	static void* libgl     = dlopen( "libGL.so.1", RTLD_NOW | RTLD_GLOBAL );
	static LumaGetProc glx = libgl ? (LumaGetProc)dlsym( libgl, "glXGetProcAddressARB" ) : NULL;
	return glx ? glx( n ) : NULL;
}
#else
static void* plugGetProc( const char* ) { return NULL; }
#endif

static const char* VS = "#version 330 core\n"
						"out vec2 uv;\n"
						"void main() {\n"
						"  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);\n"
						"  uv = p * 0.5 + 0.5;\n"
						"  gl_Position = vec4(p, 0.0, 1.0);\n"
						"}\n";
#if LUMA_KIND == 0
static const char* FS = "#version 330 core\n"
						"in vec2 uv; out vec4 color;\n"
						"uniform float brillo, rojo, modo, escala, t;\n"
						"void main() {\n"
						"  vec3 c = modo < 0.5 ? vec3(rojo * uv.x, uv.y, 0.5 + 0.5 * sin(t)) : vec3(rojo, 0.2, 0.6);\n"
						"  if (escala > 1.5) c *= 0.6 + 0.4 * step(0.5, fract(uv.x * escala));\n"
						"  color = vec4(c * brillo, 1.0);\n"
						"}\n";
#else
static const char* FS = "#version 330 core\n"
						"in vec2 uv; out vec4 color;\n"
						"uniform sampler2D inputTexture; uniform vec2 maxUV; uniform float amount;\n"
						"void main() {\n"
						"  vec4 c = texture(inputTexture, uv * maxUV);\n"
						"  color = vec4(mix(c.rgb, vec3(1.0) - c.rgb, amount), c.a);\n"
						"}\n";
#endif

static GLuint compile( GLenum type, const char* src )
{
	GLuint s = lglCreateShader( type );
	lglShaderSource( s, 1, &src, NULL );
	lglCompileShader( s );
	GLint ok = 0;
	lglGetShaderiv( s, GL_COMPILE_STATUS, &ok );
	if( !ok ) { lglDeleteShader( s ); return 0; }
	return s;
}

/* ------------------------------------------------------------ Instancia */
struct Instance
{
	float values[ NPARAMS ];
	std::string text = s_defText;
	double time      = 0;
	float bpm = 120, phase = 0;
	FFGLViewportStruct vp;
	GLuint prog = 0, vao = 0;
};

static Instance* instantiate( const FFGLViewportStruct* vp )
{
	if( !vp ) return NULL;
	const char* missing = lumaLoadGL( plugGetProc, LUMA_KIND == 2 );
	if( missing ) return NULL;
	Instance* in = new Instance();
	in->vp       = *vp;
	for( int i = 0; i < NPARAMS; i++ ) in->values[ i ] = s_defs[ i ];
#if LUMA_KIND != 2
	GLuint v = compile( GL_VERTEX_SHADER, VS ), f = compile( GL_FRAGMENT_SHADER, FS );
	if( !v || !f ) { delete in; return NULL; }
	in->prog = lglCreateProgram();
	lglAttachShader( in->prog, v );
	lglAttachShader( in->prog, f );
	lglLinkProgram( in->prog );
	lglDeleteShader( v );
	lglDeleteShader( f );
	GLint ok = 0;
	lglGetProgramiv( in->prog, GL_LINK_STATUS, &ok );
	if( !ok ) { lglDeleteProgram( in->prog ); delete in; return NULL; }
	lglGenVertexArrays( 1, &in->vao );
#endif
	return in;
}

static FFUInt32 process( Instance* in, const ProcessOpenGLStruct* pgl )
{
	if( !in || !pgl ) return FF_FAIL;
	if( getenv( "LUMATEST_CRASH" ) )
	{
		volatile int* p = NULL;
		*p              = 1;   // fallo de memoria a propósito: el anfitrión debe morir solo él
	}
	if( getenv( "LUMATEST_HANG" ) )
		for( ;; )
		{
#if defined( _WIN32 )
			Sleep( 1000 );
#else
			sleep( 1 );
#endif
		}
#if LUMA_KIND == 2
	// OpenGL clásico (FFGL 1.x): un cuadrado de color que llena la imagen.
	lglMatrixMode( GL_PROJECTION );
	lglLoadIdentity();
	lglMatrixMode( GL_MODELVIEW );
	lglLoadIdentity();
	lglColor4f( 0.0f, in->values[ P_VERDE ], 1.0f, 1.0f );
	lglBegin( GL_QUADS );
	lglVertex2f( -1, -1 );
	lglVertex2f( 1, -1 );
	lglVertex2f( 1, 1 );
	lglVertex2f( -1, 1 );
	lglEnd();
	lglColor4f( 1, 1, 1, 1 );
	return FF_SUCCESS;
#else
	lglUseProgram( in->prog );
	lglBindVertexArray( in->vao );
#if LUMA_KIND == 0
	lglUniform1f( lglGetUniformLocation( in->prog, "brillo" ), in->values[ P_BRILLO ] );
	lglUniform1f( lglGetUniformLocation( in->prog, "rojo" ), in->values[ P_ROJO ] );
	lglUniform1f( lglGetUniformLocation( in->prog, "modo" ), in->values[ P_MODO ] );
	lglUniform1f( lglGetUniformLocation( in->prog, "escala" ), in->values[ P_ESCALA ] );
	lglUniform1f( lglGetUniformLocation( in->prog, "t" ), (float)in->time );
#else
	if( pgl->numInputTextures < 1 || !pgl->inputTextures || !pgl->inputTextures[ 0 ] ) { lglBindVertexArray( 0 ); lglUseProgram( 0 ); return FF_FAIL; }
	const FFGLTextureStruct& t = *pgl->inputTextures[ 0 ];
	lglActiveTexture( GL_TEXTURE0 );
	lglBindTexture( GL_TEXTURE_2D, t.Handle );
	lglUniform1i( lglGetUniformLocation( in->prog, "inputTexture" ), 0 );
	lglUniform2f( lglGetUniformLocation( in->prog, "maxUV" ), (float)t.Width / (float)( t.HardwareWidth ? t.HardwareWidth : 1 ), (float)t.Height / (float)( t.HardwareHeight ? t.HardwareHeight : 1 ) );
	lglUniform1f( lglGetUniformLocation( in->prog, "amount" ), in->values[ P_INVERTIR ] > 0.5f ? in->values[ P_MEZCLA ] : 0.0f );
#endif
	lglDrawArrays( GL_TRIANGLES, 0, 3 );
	// Dejar el contexto como estaba (lo exige FFGL 2).
	lglBindTexture( GL_TEXTURE_2D, 0 );
	lglBindVertexArray( 0 );
	lglUseProgram( 0 );
	return FF_SUCCESS;
#endif
}

static void destroy( Instance* in )
{
	if( !in ) return;
	if( in->prog ) lglDeleteProgram( in->prog );
	if( in->vao ) lglDeleteVertexArrays( 1, &in->vao );
	delete in;
}

/* -------------------------------------------------------------- plugMain */
static FFMixed u( FFUInt32 v ) { FFMixed r; r.PointerValue = NULL; r.UIntValue = v; return r; }
static FFMixed ptr( const void* p ) { FFMixed r; r.PointerValue = (void*)p; return r; }
static FFMixed fl( float f ) { FFMixed r; r.PointerValue = NULL; memcpy( &r.UIntValue, &f, 4 ); return r; }
static float toF( FFUInt32 v ) { float f; memcpy( &f, &v, 4 ); return f; }

FFGL_EXPORT FFMixed FFGL_CALL plugMain( FFUInt32 code, FFMixed in, FFInstanceID id )
{
	Instance* inst = (Instance*)id;
	switch( code )
	{
	case FF_GET_INFO: return ptr( &s_info );
	case FF_GET_EXTENDED_INFO: return ptr( &s_ext );
	case FF_INITIALISE_V2: return u( s_info.APIMajorVersion >= 2 ? FF_SUCCESS : FF_FAIL );
	case FF_INITIALISE: return u( s_info.APIMajorVersion < 2 ? FF_SUCCESS : FF_FAIL );
	case FF_DEINITIALISE: return u( FF_SUCCESS );
	case FF_GET_NUM_PARAMETERS: return u( NPARAMS );
	case FF_GET_PARAMETER_NAME: return in.UIntValue < NPARAMS ? ptr( s_names[ in.UIntValue ] ) : u( FF_FAIL );
	case FF_GET_PARAMETER_TYPE: return u( in.UIntValue < NPARAMS ? s_types[ in.UIntValue ] : FF_FAIL );
	case FF_GET_PARAMETER_DEFAULT:
		if( in.UIntValue >= NPARAMS ) return u( FF_FAIL );
		if( s_types[ in.UIntValue ] == FF_TYPE_TEXT ) return ptr( s_defText );
		return fl( s_defs[ in.UIntValue ] );
	case FF_GET_RANGE: {
		GetRangeStruct* r = (GetRangeStruct*)in.PointerValue;
		if( !r || r->parameterNumber >= NPARAMS ) return u( FF_FAIL );
		r->range.min = s_mins[ r->parameterNumber ];
		r->range.max = s_maxs[ r->parameterNumber ];
		return u( FF_SUCCESS );
	}
	case FF_GET_NUM_PARAMETER_ELEMENTS:
		return u( in.UIntValue < NPARAMS && s_types[ in.UIntValue ] == FF_TYPE_OPTION ? 2 : 0 );
	case FF_GET_PARAMETER_ELEMENT_NAME: {
		const GetParameterElementNameStruct* a = (const GetParameterElementNameStruct*)in.PointerValue;
		if( !a || a->ParameterNumber >= NPARAMS || s_types[ a->ParameterNumber ] != FF_TYPE_OPTION || a->ElementNumber > 1 ) return u( FF_FAIL );
		return ptr( s_options[ a->ElementNumber ] );
	}
	case FF_GET_PARAMETER_ELEMENT_VALUE: {
		const GetParameterElementValueStruct* a = (const GetParameterElementValueStruct*)in.PointerValue;
		if( !a || a->ElementNumber > 1 ) return u( FF_FAIL );
		return fl( (float)a->ElementNumber );
	}
	case FF_GET_PRAMETER_VISIBILITY: return u( FF_TRUE );
	case FF_GET_PLUGIN_CAPS:
		if( in.UIntValue == FF_CAP_SET_TIME ) return u( FF_TRUE );
		if( in.UIntValue == FF_CAP_MINIMUM_INPUT_FRAMES || in.UIntValue == FF_CAP_MAXIMUM_INPUT_FRAMES ) return u( s_info.PluginType == FF_EFFECT ? 1 : 0 );
		return u( FF_FALSE );
	case FF_INSTANTIATE_GL: {
		Instance* n = instantiate( (const FFGLViewportStruct*)in.PointerValue );
		return n ? ptr( n ) : u( FF_FAIL );
	}
	case FF_DEINSTANTIATE_GL: destroy( inst ); return u( FF_SUCCESS );
	case FF_PROCESS_OPENGL: return u( process( inst, (const ProcessOpenGLStruct*)in.PointerValue ) );
	case FF_SET_PARAMETER: {
		const SetParameterStruct* s = (const SetParameterStruct*)in.PointerValue;
		if( !inst || !s || s->ParameterNumber >= NPARAMS ) return u( FF_FAIL );
		if( s_types[ s->ParameterNumber ] == FF_TYPE_TEXT )
		{
			const char* t = (const char*)s->NewParameterValue.PointerValue;
			inst->text    = t ? t : "";
			return u( FF_SUCCESS );
		}
		inst->values[ s->ParameterNumber ] = toF( s->NewParameterValue.UIntValue );
		return u( FF_SUCCESS );
	}
	case FF_GET_PARAMETER:
		if( !inst || in.UIntValue >= NPARAMS ) return u( FF_FAIL );
		if( s_types[ in.UIntValue ] == FF_TYPE_TEXT ) return ptr( inst->text.c_str() );
		return fl( inst->values[ in.UIntValue ] );
	case FF_GET_PARAMETER_DISPLAY: return u( FF_FAIL );
	case FF_SET_TIME:
		if( !inst || !in.PointerValue ) return u( FF_FAIL );
		inst->time = *(const double*)in.PointerValue;
		return u( FF_SUCCESS );
	case FF_SET_BEATINFO: {
		const SetBeatinfoStruct* b = (const SetBeatinfoStruct*)in.PointerValue;
		if( !inst || !b ) return u( FF_FAIL );
		inst->bpm   = b->bpm;
		inst->phase = b->barPhase;
		return u( FF_SUCCESS );
	}
	case FF_SET_HOSTINFO: return u( FF_SUCCESS );
	case FF_RESIZE:
		if( !inst || !in.PointerValue ) return u( FF_FAIL );
		inst->vp = *(const FFGLViewportStruct*)in.PointerValue;
		return u( FF_SUCCESS );
	case FF_CONNECT:
	case FF_DISCONNECT: return u( FF_SUCCESS );
	default: return u( FF_FAIL );
	}
}
