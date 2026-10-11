// ffglhost.cpp — anfitrión de plugins FFGL (FreeFrame GL, los de Resolume) para LumaMap.
//
// Es un programa aparte: carga UN plugin (.dll en Windows, .so en Linux), crea su propio
// contexto OpenGL invisible y habla con LumaMap por stdin/stdout con un protocolo binario.
// Si el plugin se cuelga o se cae, solo muere este proceso: la app sigue funcionando.
//
// Contexto OpenGL:
//   Windows: ventana oculta + WGL (wglCreateContextAttribsARB 4.1 núcleo; si no, compatibilidad).
//   Linux:   OSMesa (libOSMesa.so.8, cargada con dlopen: no hacen falta cabeceras). Solo para pruebas.
//
// Protocolo (todo en little-endian):
//   petición:  u8 comando, u32 longitud, datos
//   respuesta: u8 'K' (bien) o 'E' (error, datos = JSON {"error": "..."}), u32 longitud, datos
// Comandos:
//   'O' abrir:   ruta del plugin en UTF-8                 → JSON con la información del plugin
//   'I' info:    (nada)                                   → JSON con la información y los valores actuales
//   'P' número:  u32 parámetro, f32 valor                 → (nada)
//   'S' texto:   u32 parámetro, texto UTF-8               → (nada)
//   'R' dibujar: u32 ancho, u32 alto, f64 tiempo (s), f32 bpm, f32 fase del compás (0..1),
//                u32 bytes de entrada, [entrada RGBA ancho×alto, fila 0 = arriba]
//                → u32 ancho, u32 alto, RGBA ancho×alto (fila 0 = arriba)
//   'Q' salir:   (nada)                                   → (nada) y termina
//
// Compatible: FFGL 2.x (Resolume 7) fuentes y efectos de una entrada. FFGL 1.5/1.6 (64 bits)
// con contexto de compatibilidad. Mezcladores (mixer): no.
#include "ffgl_defs.h"
#include "glmini.h"

#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#if defined( _WIN32 )
#include <fcntl.h>
#include <io.h>
#include <signal.h>
#else
#include <dlfcn.h>
#include <signal.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

static const char* HOST_VERSION = "1.0";
static const uint32_t MAX_SIDE   = 4096;                          // lado máximo de un fotograma
static const uint32_t MAX_MSG    = MAX_SIDE * MAX_SIDE * 4 + 64;  // petición más grande admitida

/* ------------------------------------------------------------------ E/S */
static int g_in  = 0;
static int g_out = 1;   // copia privada de stdout: el stdout «público» va a stderr (printf de plugins)

static bool readAll( void* p, size_t n )
{
	unsigned char* b = (unsigned char*)p;
	while( n > 0 )
	{
		unsigned int chunk = (unsigned int)( n > ( 1u << 20 ) ? ( 1u << 20 ) : n );
#if defined( _WIN32 )
		int r = _read( g_in, b, chunk );
#else
		ssize_t r = read( g_in, b, chunk );
		if( r < 0 && errno == EINTR ) continue;
#endif
		if( r <= 0 ) return false;
		b += r;
		n -= (size_t)r;
	}
	return true;
}
static bool writeAll( const void* p, size_t n )
{
	const unsigned char* b = (const unsigned char*)p;
	while( n > 0 )
	{
		unsigned int chunk = (unsigned int)( n > ( 1u << 20 ) ? ( 1u << 20 ) : n );
#if defined( _WIN32 )
		int r = _write( g_out, b, chunk );
#else
		ssize_t r = write( g_out, b, chunk );
		if( r < 0 && errno == EINTR ) continue;
#endif
		if( r <= 0 ) return false;
		b += r;
		n -= (size_t)r;
	}
	return true;
}
static void put32( unsigned char* p, uint32_t v ) { p[ 0 ] = v & 255; p[ 1 ] = ( v >> 8 ) & 255; p[ 2 ] = ( v >> 16 ) & 255; p[ 3 ] = v >> 24; }
static uint32_t get32( const unsigned char* p ) { return p[ 0 ] | ( p[ 1 ] << 8 ) | ( p[ 2 ] << 16 ) | ( (uint32_t)p[ 3 ] << 24 ); }
static float getF32( const unsigned char* p ) { uint32_t v = get32( p ); float f; memcpy( &f, &v, 4 ); return f; }
static double getF64( const unsigned char* p ) { double d; memcpy( &d, p, 8 ); return d; }   // x86/ARM: little-endian

static bool reply( char status, const void* data, uint32_t len )
{
	unsigned char h[ 5 ];
	h[ 0 ] = (unsigned char)status;
	put32( h + 1, len );
	return writeAll( h, 5 ) && ( len == 0 || writeAll( data, len ) );
}

/* ----------------------------------------------------------------- JSON */
// Texto válido en JSON. Los nombres de plugins viejos suelen venir en Latin-1: se pasan a UTF-8.
static bool validUtf8( const std::string& s )
{
	size_t i = 0, n = s.size();
	while( i < n )
	{
		unsigned char c = s[ i ];
		int k           = c < 0x80 ? 0 : ( c >> 5 ) == 6 ? 1 : ( c >> 4 ) == 14 ? 2 : ( c >> 3 ) == 30 ? 3 : -1;
		if( k < 0 || i + k >= n + ( k == 0 ? 1 : 0 ) ) return false;
		for( int j = 1; j <= k; j++ )
			if( ( (unsigned char)s[ i + j ] >> 6 ) != 2 ) return false;
		i += k + 1;
	}
	return true;
}
static std::string jstr( const std::string& in )
{
	std::string s = in;
	if( !validUtf8( s ) )
	{
		s.clear();
		for( unsigned char c : in )
		{
			if( c < 0x80 ) s += (char)c;
			else { s += (char)( 0xC0 | ( c >> 6 ) ); s += (char)( 0x80 | ( c & 63 ) ); }
		}
	}
	std::string o = "\"";
	for( unsigned char c : s )
	{
		if( c == '"' ) o += "\\\"";
		else if( c == '\\' ) o += "\\\\";
		else if( c < 0x20 )
		{
			char b[ 8 ];
			snprintf( b, sizeof b, "\\u%04x", c );
			o += b;
		}
		else o += (char)c;
	}
	return o + "\"";
}
static std::string jnum( double v )
{
	if( !std::isfinite( v ) ) v = 0;
	char b[ 32 ];
	snprintf( b, sizeof b, "%.9g", v );
	return b;
}
static bool replyError( const std::string& msg )
{
	std::string j = "{\"error\":" + jstr( msg ) + "}";
	return reply( 'E', j.data(), (uint32_t)j.size() );
}
static bool replyJson( const std::string& j ) { return reply( 'K', j.data(), (uint32_t)j.size() ); }

/* ------------------------------------------------- Cierres del plugin */
// Un plugin que se cae (memoria, división…) termina este proceso con un aviso claro en stderr.
#if defined( _WIN32 )
static LONG WINAPI onCrash( EXCEPTION_POINTERS* e )
{
	char b[ 128 ];
	snprintf( b, sizeof b, "FFGLHOST_CRASH excepcion 0x%08lx\n", e && e->ExceptionRecord ? (unsigned long)e->ExceptionRecord->ExceptionCode : 0ul );
	_write( 2, b, (unsigned int)strlen( b ) );
	TerminateProcess( GetCurrentProcess(), 3 );
	return EXCEPTION_EXECUTE_HANDLER;
}
static void onAbort( int ) { const char* m = "FFGLHOST_CRASH abort\n"; _write( 2, m, (unsigned int)strlen( m ) ); TerminateProcess( GetCurrentProcess(), 3 ); }
#else
static void onSignal( int sig )
{
	char b[ 64 ] = "FFGLHOST_CRASH senal ";
	size_t n     = strlen( b );
	if( sig >= 10 ) b[ n++ ] = (char)( '0' + sig / 10 );
	b[ n++ ] = (char)( '0' + sig % 10 );
	b[ n++ ] = '\n';
	ssize_t w = write( 2, b, n );
	(void)w;
	_exit( 3 );
}
#endif
static void installCrashHandlers()
{
#if defined( _WIN32 )
	// Sin ventanas de «dejó de funcionar» ni de «falta un archivo .dll»: el error llega a LumaMap.
	SetErrorMode( SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX );
	SetUnhandledExceptionFilter( onCrash );
#if defined( _MSC_VER )
	_set_abort_behavior( 0, _WRITE_ABORT_MSG | _CALL_REPORTFAULT );
#endif
	signal( SIGABRT, onAbort );
#else
	struct sigaction sa;
	memset( &sa, 0, sizeof sa );
	sa.sa_handler = onSignal;
	int sigs[]    = { SIGSEGV, SIGBUS, SIGFPE, SIGILL, SIGABRT };
	for( int s : sigs ) sigaction( s, &sa, NULL );
	signal( SIGPIPE, SIG_IGN );
#endif
}

/* ---------------------------------------------------- Contexto OpenGL */
static std::string g_glProfile;   // "core" | "compat" | "legacy"
static LumaGetProc g_getProc = NULL;

#if defined( _WIN32 )
static HWND g_wnd  = NULL;
static HDC g_dc    = NULL;
static HGLRC g_rc  = NULL;
typedef HGLRC( WINAPI* PFN_wglCreateContextAttribsARB )( HDC, HGLRC, const int* );
#define WGL_CONTEXT_MAJOR_VERSION_ARB 0x2091
#define WGL_CONTEXT_MINOR_VERSION_ARB 0x2092
#define WGL_CONTEXT_PROFILE_MASK_ARB 0x9126
#define WGL_CONTEXT_CORE_PROFILE_BIT_ARB 0x0001
#define WGL_CONTEXT_COMPATIBILITY_PROFILE_BIT_ARB 0x0002

static bool createContext( bool preferCompat, std::string& err )
{
	WNDCLASSW wc     = {};
	wc.style         = CS_OWNDC;
	wc.lpfnWndProc   = DefWindowProcW;
	wc.hInstance     = GetModuleHandleW( NULL );
	wc.lpszClassName = L"LumaMapFFGLHost";
	RegisterClassW( &wc );
	// Ventana que nunca se muestra: solo sirve para tener un contexto OpenGL.
	g_wnd = CreateWindowExW( WS_EX_TOOLWINDOW, wc.lpszClassName, L"LumaMap FFGL", WS_OVERLAPPEDWINDOW, 0, 0, 64, 64, NULL, NULL, wc.hInstance, NULL );
	if( !g_wnd ) { err = "No se pudo crear la ventana oculta para OpenGL"; return false; }
	g_dc                      = GetDC( g_wnd );
	PIXELFORMATDESCRIPTOR pfd = {};
	pfd.nSize                 = sizeof pfd;
	pfd.nVersion              = 1;
	pfd.dwFlags               = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
	pfd.iPixelType            = PFD_TYPE_RGBA;
	pfd.cColorBits            = 32;
	pfd.cAlphaBits            = 8;
	pfd.cDepthBits            = 24;
	pfd.cStencilBits          = 8;
	int pf                    = ChoosePixelFormat( g_dc, &pfd );
	if( !pf || !SetPixelFormat( g_dc, pf, &pfd ) ) { err = "La tarjeta gráfica no ofrece un formato OpenGL"; return false; }
	HGLRC tmp = wglCreateContext( g_dc );
	if( !tmp || !wglMakeCurrent( g_dc, tmp ) ) { err = "No se pudo crear un contexto OpenGL (¿controlador de la tarjeta gráfica instalado?)"; return false; }
	PFN_wglCreateContextAttribsARB create = (PFN_wglCreateContextAttribsARB)wglGetProcAddress( "wglCreateContextAttribsARB" );
	const char* forced                    = getenv( "LUMAMAP_FFGL_PROFILE" );
	if( forced && !strcmp( forced, "compat" ) ) preferCompat = true;
	if( forced && !strcmp( forced, "core" ) ) preferCompat = false;
	if( create )
	{
		int core[]   = { WGL_CONTEXT_MAJOR_VERSION_ARB, 4, WGL_CONTEXT_MINOR_VERSION_ARB, 1, WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_CORE_PROFILE_BIT_ARB, 0 };
		int compat[] = { WGL_CONTEXT_MAJOR_VERSION_ARB, 4, WGL_CONTEXT_MINOR_VERSION_ARB, 1, WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_COMPATIBILITY_PROFILE_BIT_ARB, 0 };
		const int* order[ 2 ] = { preferCompat ? compat : core, preferCompat ? core : compat };
		for( int i = 0; i < 2 && !g_rc; i++ )
		{
			g_rc = create( g_dc, NULL, order[ i ] );
			if( g_rc ) g_glProfile = order[ i ] == core ? "core" : "compat";
		}
	}
	if( g_rc )
	{
		wglMakeCurrent( NULL, NULL );
		wglDeleteContext( tmp );
		wglMakeCurrent( g_dc, g_rc );
	}
	else
	{
		g_rc        = tmp;   // OpenGL antiguo (sin 4.1): casi ningún plugin funcionará, se avisa con la versión
		g_glProfile = "legacy";
	}
	return true;
}
static void destroyContext()
{
	if( g_rc ) { wglMakeCurrent( NULL, NULL ); wglDeleteContext( g_rc ); g_rc = NULL; }
	if( g_wnd ) { ReleaseDC( g_wnd, g_dc ); DestroyWindow( g_wnd ); g_wnd = NULL; }
}
#else
// OSMesa (Mesa por software): constantes de GL/osmesa.h.
#define OSMESA_FORMAT 0x22
#define OSMESA_DEPTH_BITS 0x30
#define OSMESA_STENCIL_BITS 0x31
#define OSMESA_ACCUM_BITS 0x32
#define OSMESA_PROFILE 0x33
#define OSMESA_CORE_PROFILE 0x34
#define OSMESA_COMPAT_PROFILE 0x35
#define OSMESA_CONTEXT_MAJOR_VERSION 0x36
#define OSMESA_CONTEXT_MINOR_VERSION 0x37
typedef void* OSMesaContext;
typedef OSMesaContext ( *PFN_OSMesaCreateContextAttribs )( const int*, OSMesaContext );
typedef unsigned char ( *PFN_OSMesaMakeCurrent )( OSMesaContext, void*, GLenum, GLsizei, GLsizei );
typedef void ( *PFN_OSMesaDestroyContext )( OSMesaContext );
static void* g_osmesa       = NULL;
static OSMesaContext g_ctx  = NULL;
static unsigned char g_dummy[ 16 * 16 * 4 ];
static PFN_OSMesaDestroyContext g_destroy = NULL;

static bool createContext( bool preferCompat, std::string& err )
{
	const char* libs[] = { getenv( "LUMAMAP_OSMESA" ), "libOSMesa.so.8", "libOSMesa.so.6", "libOSMesa.so" };
	for( const char* l : libs )
		if( l && *l && !g_osmesa ) g_osmesa = dlopen( l, RTLD_NOW | RTLD_GLOBAL );   // global: el plugin también encuentra OpenGL
	if( !g_osmesa ) { err = "No se encontró OSMesa (libOSMesa.so.8): instala libosmesa6"; return false; }
	PFN_OSMesaCreateContextAttribs create = (PFN_OSMesaCreateContextAttribs)dlsym( g_osmesa, "OSMesaCreateContextAttribs" );
	PFN_OSMesaMakeCurrent makeCurrent     = (PFN_OSMesaMakeCurrent)dlsym( g_osmesa, "OSMesaMakeCurrent" );
	g_destroy                             = (PFN_OSMesaDestroyContext)dlsym( g_osmesa, "OSMesaDestroyContext" );
	g_getProc                             = (LumaGetProc)dlsym( g_osmesa, "OSMesaGetProcAddress" );
	if( !create || !makeCurrent || !g_getProc ) { err = "OSMesa incompleto (falta OSMesaCreateContextAttribs)"; return false; }
	const char* forced = getenv( "LUMAMAP_FFGL_PROFILE" );
	if( forced && !strcmp( forced, "compat" ) ) preferCompat = true;
	if( forced && !strcmp( forced, "core" ) ) preferCompat = false;
	int core[]   = { OSMESA_FORMAT, GL_RGBA, OSMESA_DEPTH_BITS, 24, OSMESA_STENCIL_BITS, 8, OSMESA_ACCUM_BITS, 0, OSMESA_PROFILE, OSMESA_CORE_PROFILE, OSMESA_CONTEXT_MAJOR_VERSION, 4, OSMESA_CONTEXT_MINOR_VERSION, 1, 0 };
	int compat[] = { OSMESA_FORMAT, GL_RGBA, OSMESA_DEPTH_BITS, 24, OSMESA_STENCIL_BITS, 8, OSMESA_ACCUM_BITS, 0, OSMESA_PROFILE, OSMESA_COMPAT_PROFILE, 0 };
	const int* order[ 2 ] = { preferCompat ? compat : core, preferCompat ? core : compat };
	for( int i = 0; i < 2 && !g_ctx; i++ )
	{
		g_ctx = create( order[ i ], NULL );
		if( g_ctx ) g_glProfile = order[ i ] == core ? "core" : "compat";
	}
	if( !g_ctx ) { err = "OSMesa no pudo crear un contexto OpenGL"; return false; }
	if( !makeCurrent( g_ctx, g_dummy, GL_UNSIGNED_BYTE, 16, 16 ) ) { err = "OSMesa no pudo activar el contexto"; return false; }
	return true;
}
static void destroyContext()
{
	if( g_ctx && g_destroy ) g_destroy( g_ctx );
	g_ctx = NULL;
}
#endif

/* --------------------------------------------------------------- Plugin */
struct Option
{
	std::string name;
	float value;
};
struct Param
{
	uint32_t index;
	std::string name;
	uint32_t type;
	float def = 0, min = 0, max = 1, value = 0;
	bool hidden = false;
	std::string text, defText;
	std::vector< Option > options;
};

static void* g_lib            = NULL;
static FF_Main_FuncPtr g_main = NULL;
static FFInstanceID g_inst    = NULL;
static PluginInfoStruct g_info;
static std::string g_name, g_id, g_desc, g_about, g_pluginVersion;
static uint32_t g_minInputs = 0, g_maxInputs = 0;
static bool g_timeCap       = false;
static std::vector< Param > g_params;
static std::string g_glVersion, g_glRenderer, g_glVendor;

// Objetos OpenGL del anfitrión: textura de salida (con su FBO) y textura de entrada.
static GLuint g_fbo = 0, g_outTex = 0, g_inTex = 0;
static uint32_t g_w = 0, g_h = 0, g_inW = 0, g_inH = 0;
static std::vector< unsigned char > g_tmp, g_frame;

static FFMixed call( FFUInt32 code, FFMixed in, FFInstanceID inst = NULL ) { return g_main( code, in, inst ); }
static FFMixed callU( FFUInt32 code, FFUInt32 v, FFInstanceID inst = NULL )
{
	FFMixed in;
	in.PointerValue = NULL;
	in.UIntValue    = v;
	return g_main( code, in, inst );
}
static FFMixed callP( FFUInt32 code, void* p, FFInstanceID inst = NULL )
{
	FFMixed in;
	in.PointerValue = p;
	return g_main( code, in, inst );
}
// Puntero devuelto por el plugin, o NULL si es un fallo (FF_FAIL en los 32 bits bajos).
static const char* asPtr( FFMixed r )
{
	if( !r.PointerValue || r.UIntValue == FF_FAIL ) return NULL;
	return (const char*)r.PointerValue;
}
static float asFloat( FFMixed r )
{
	float f;
	FFUInt32 u = r.UIntValue;
	memcpy( &f, &u, 4 );
	return std::isfinite( f ) ? f : 0.0f;
}
static std::string cstr( const char* p, size_t max )
{
	if( !p ) return "";
	size_t n = 0;
	while( n < max && p[ n ] ) n++;
	std::string s( p, n );
	while( !s.empty() && ( s.back() == ' ' || s.back() == '\0' ) ) s.pop_back();
	return s;
}

static const char* typeName( uint32_t t )
{
	switch( t )
	{
	case FF_TYPE_BOOLEAN: return "bool";
	case FF_TYPE_EVENT: return "event";
	case FF_TYPE_RED: return "red";
	case FF_TYPE_GREEN: return "green";
	case FF_TYPE_BLUE: return "blue";
	case FF_TYPE_XPOS: return "xpos";
	case FF_TYPE_YPOS: return "ypos";
	case FF_TYPE_STANDARD: return "standard";
	case FF_TYPE_OPTION: return "option";
	case FF_TYPE_BUFFER: return "buffer";
	case FF_TYPE_INTEGER: return "integer";
	case FF_TYPE_FILE: return "file";
	case FF_TYPE_TEXT: return "text";
	case FF_TYPE_HUE: return "hue";
	case FF_TYPE_SATURATION: return "saturation";
	case FF_TYPE_BRIGHTNESS: return "brightness";
	case FF_TYPE_ALPHA: return "alpha";
	default: return "standard";
	}
}
static bool isText( uint32_t t ) { return t == FF_TYPE_TEXT || t == FF_TYPE_FILE; }
static bool isV2() { return g_info.APIMajorVersion >= 2; }

static std::string infoJson()
{
	std::string j = "{\"name\":" + jstr( g_name ) + ",\"id\":" + jstr( g_id );
	j += ",\"type\":\"";
	j += g_info.PluginType == FF_SOURCE ? "source" : "effect";
	j += "\",\"apiMajor\":" + jnum( g_info.APIMajorVersion ) + ",\"apiMinor\":" + jnum( g_info.APIMinorVersion );
	j += ",\"version\":" + jstr( g_pluginVersion ) + ",\"description\":" + jstr( g_desc ) + ",\"about\":" + jstr( g_about );
	j += ",\"minInputs\":" + jnum( g_minInputs ) + ",\"maxInputs\":" + jnum( g_maxInputs ) + ",\"time\":" + ( g_timeCap ? "true" : "false" );
	j += ",\"host\":" + jstr( HOST_VERSION );
	j += ",\"gl\":{\"version\":" + jstr( g_glVersion ) + ",\"renderer\":" + jstr( g_glRenderer ) + ",\"vendor\":" + jstr( g_glVendor ) + ",\"profile\":" + jstr( g_glProfile ) + "}";
	j += ",\"params\":[";
	for( size_t i = 0; i < g_params.size(); i++ )
	{
		const Param& p = g_params[ i ];
		if( i ) j += ",";
		j += "{\"index\":" + jnum( p.index ) + ",\"name\":" + jstr( p.name ) + ",\"type\":\"" + typeName( p.type ) + "\"";
		j += ",\"hidden\":";
		j += p.hidden ? "true" : "false";
		if( isText( p.type ) )
			j += ",\"default\":" + jstr( p.defText ) + ",\"value\":" + jstr( p.text );
		else
			j += ",\"default\":" + jnum( p.def ) + ",\"min\":" + jnum( p.min ) + ",\"max\":" + jnum( p.max ) + ",\"value\":" + jnum( p.value );
		if( !p.options.empty() )
		{
			j += ",\"options\":[";
			for( size_t k = 0; k < p.options.size(); k++ )
				j += ( k ? "," : "" ) + std::string( "{\"name\":" ) + jstr( p.options[ k ].name ) + ",\"value\":" + jnum( p.options[ k ].value ) + "}";
			j += "]";
		}
		j += "}";
	}
	return j + "]}";
}

// Crea (o cambia de tamaño) la textura de salida con su FBO.
static bool ensureTarget( uint32_t w, uint32_t h, std::string& err )
{
	if( !g_fbo ) lglGenFramebuffers( 1, &g_fbo );
	if( !g_outTex )
	{
		lglGenTextures( 1, &g_outTex );
		lglBindTexture( GL_TEXTURE_2D, g_outTex );
		lglTexParameteri( GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR );
		lglTexParameteri( GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR );
		lglTexParameteri( GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE );
		lglTexParameteri( GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE );
	}
	if( w != g_w || h != g_h )
	{
		lglBindTexture( GL_TEXTURE_2D, g_outTex );
		lglTexImage2D( GL_TEXTURE_2D, 0, GL_RGBA8, (GLsizei)w, (GLsizei)h, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL );
		lglBindTexture( GL_TEXTURE_2D, 0 );
		lglBindFramebuffer( GL_FRAMEBUFFER, g_fbo );
		lglFramebufferTexture2D( GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_outTex, 0 );
		if( lglCheckFramebufferStatus( GL_FRAMEBUFFER ) != GL_FRAMEBUFFER_COMPLETE ) { err = "No se pudo crear la imagen de salida en OpenGL"; return false; }
		g_w = w;
		g_h = h;
	}
	lglBindFramebuffer( GL_FRAMEBUFFER, g_fbo );
	lglViewport( 0, 0, (GLsizei)w, (GLsizei)h );
	return true;
}

static bool openPlugin( const std::string& path, std::string& err )
{
#if defined( _WIN32 )
	int n = MultiByteToWideChar( CP_UTF8, 0, path.c_str(), -1, NULL, 0 );
	std::wstring wp( n > 0 ? n : 1, L'\0' );
	if( n > 0 ) MultiByteToWideChar( CP_UTF8, 0, path.c_str(), -1, &wp[ 0 ], n );
	DWORD attr = GetFileAttributesW( wp.c_str() );
	if( attr == INVALID_FILE_ATTRIBUTES || ( attr & FILE_ATTRIBUTE_DIRECTORY ) ) { err = "No existe el archivo del plugin"; return false; }
	// Las .dll que necesite el plugin se buscan en su propia carpeta.
	HMODULE lib = LoadLibraryExW( wp.c_str(), NULL, LOAD_WITH_ALTERED_SEARCH_PATH );
	if( !lib )
	{
		DWORD e = GetLastError();
		if( e == ERROR_BAD_EXE_FORMAT ) err = "No es un plugin de 64 bits para Windows (los de 32 bits no sirven) o el archivo está dañado";
		else if( e == ERROR_MOD_NOT_FOUND ) err = "Al plugin le falta un archivo .dll que necesita (instala lo que pida su autor, p. ej. Visual C++ Redistributable)";
		else { char b[ 96 ]; snprintf( b, sizeof b, "Windows no pudo cargar el plugin (error %lu)", (unsigned long)e ); err = b; }
		return false;
	}
	g_lib  = lib;
	g_main = (FF_Main_FuncPtr)GetProcAddress( lib, "plugMain" );
#else
	struct stat st;
	if( stat( path.c_str(), &st ) != 0 || !S_ISREG( st.st_mode ) ) { err = "No existe el archivo del plugin"; return false; }
	g_lib = dlopen( path.c_str(), RTLD_NOW | RTLD_LOCAL );
	if( !g_lib ) { const char* e = dlerror(); err = std::string( "No se pudo cargar el plugin: " ) + ( e ? e : "?" ); return false; }
	g_main = (FF_Main_FuncPtr)dlsym( g_lib, "plugMain" );
#endif
	if( !g_main ) { err = "No es un plugin FFGL (no tiene la función plugMain)"; return false; }

	// Información básica (no necesita OpenGL).
	const PluginInfoStruct* info = (const PluginInfoStruct*)asPtr( callU( FF_GET_INFO, 0 ) );
	if( !info ) { err = "El plugin no da su información (FF_GET_INFO)"; return false; }
	g_info = *info;
	g_name = cstr( g_info.PluginName, 16 );
	g_id   = cstr( g_info.PluginUniqueID, 4 );
	if( g_info.APIMajorVersion < 1 || g_info.APIMajorVersion > 2 )
	{
		char b[ 128 ];
		snprintf( b, sizeof b, "Versión de FFGL no compatible (%u.%u): sirven FFGL 2.x y 1.5/1.6", g_info.APIMajorVersion, g_info.APIMinorVersion );
		err = b;
		return false;
	}
	if( g_info.PluginType == FF_MIXER ) { err = "Es un plugin mezclador (mixer): LumaMap aún no los usa (EN DESARROLLO)"; return false; }
	if( g_info.PluginType != FF_SOURCE && g_info.PluginType != FF_EFFECT ) { err = "Tipo de plugin desconocido"; return false; }

	// Contexto OpenGL: FFGL 2 pide OpenGL 4.1; FFGL 1 usa el OpenGL clásico (compatibilidad).
	if( !createContext( !isV2(), err ) ) return false;
	if( const char* missing = lumaLoadGL( g_getProc, 0 ) )
	{
		const char* v = lglGetString ? (const char*)lglGetString( GL_VERSION ) : NULL;
		err           = std::string( "OpenGL de este equipo es demasiado antiguo para plugins FFGL (falta " ) + missing + ( v ? std::string( "; versión " ) + v : "" ) + "). Actualiza el controlador de la tarjeta gráfica.";
		return false;
	}
	g_glVersion  = cstr( (const char*)lglGetString( GL_VERSION ), 200 );
	g_glRenderer = cstr( (const char*)lglGetString( GL_RENDERER ), 200 );
	g_glVendor   = cstr( (const char*)lglGetString( GL_VENDOR ), 200 );

	// Inicializar la biblioteca del plugin.
	FFMixed r = callU( isV2() ? FF_INITIALISE_V2 : FF_INITIALISE, 0 );
	if( r.UIntValue != FF_SUCCESS ) { err = "El plugin no pudo iniciarse (FF_INITIALISE)"; return false; }

	if( const PluginExtendedInfoStruct* ext = (const PluginExtendedInfoStruct*)asPtr( callU( FF_GET_EXTENDED_INFO, 0 ) ) )
	{
		char b[ 32 ];
		snprintf( b, sizeof b, "%u.%u", ext->PluginMajorVersion, ext->PluginMinorVersion );
		g_pluginVersion = b;
		g_desc          = cstr( ext->Description, 2000 );
		g_about         = cstr( ext->About, 2000 );
	}
	FFUInt32 cap = callU( FF_GET_PLUGIN_CAPS, FF_CAP_MINIMUM_INPUT_FRAMES ).UIntValue;
	g_minInputs  = cap == FF_FAIL ? 0 : cap;
	cap          = callU( FF_GET_PLUGIN_CAPS, FF_CAP_MAXIMUM_INPUT_FRAMES ).UIntValue;
	g_maxInputs  = cap == FF_FAIL ? 0 : cap;
	g_timeCap    = callU( FF_GET_PLUGIN_CAPS, FF_CAP_SET_TIME ).UIntValue == FF_TRUE;
	if( g_info.PluginType == FF_EFFECT && g_minInputs > 1 ) { err = "El efecto necesita varias entradas: LumaMap solo le da una (EN DESARROLLO)"; return false; }

	// Parámetros.
	FFUInt32 np = callU( FF_GET_NUM_PARAMETERS, 0 ).UIntValue;
	if( np == FF_FAIL ) np = 0;
	if( np > 1024 ) { err = "El plugin dice tener demasiados parámetros"; return false; }
	for( FFUInt32 i = 0; i < np; i++ )
	{
		Param p;
		p.index = i;
		p.name  = cstr( asPtr( callU( FF_GET_PARAMETER_NAME, i ) ), isV2() ? 256 : 16 );
		if( p.name.empty() ) p.name = "Parámetro " + std::to_string( i + 1 );
		p.type = callU( FF_GET_PARAMETER_TYPE, i ).UIntValue;
		if( isText( p.type ) )
		{
			p.defText = cstr( asPtr( callU( FF_GET_PARAMETER_DEFAULT, i ) ), 4096 );
			p.text    = p.defText;
		}
		else
		{
			p.def = asFloat( callU( FF_GET_PARAMETER_DEFAULT, i ) );
			if( isV2() )
			{
				GetRangeStruct gr = { i, { 0, 1 } };
				if( callP( FF_GET_RANGE, &gr ).UIntValue == FF_SUCCESS && std::isfinite( gr.range.min ) && std::isfinite( gr.range.max ) && gr.range.max > gr.range.min )
				{
					p.min = gr.range.min;
					p.max = gr.range.max;
				}
			}
			if( p.type == FF_TYPE_OPTION )
			{
				FFUInt32 ne = callU( FF_GET_NUM_PARAMETER_ELEMENTS, i ).UIntValue;
				if( ne != FF_FAIL && ne <= 1024 )
					for( FFUInt32 k = 0; k < ne; k++ )
					{
						GetParameterElementNameStruct gn  = { i, k };
						GetParameterElementValueStruct gv = { i, k };
						Option o;
						o.name  = cstr( asPtr( callP( FF_GET_PARAMETER_ELEMENT_NAME, &gn ) ), 256 );
						o.value = asFloat( callP( FF_GET_PARAMETER_ELEMENT_VALUE, &gv ) );
						p.options.push_back( o );
					}
			}
			p.value = p.def;
		}
		if( isV2() ) p.hidden = callU( FF_GET_PRAMETER_VISIBILITY, i ).UIntValue == FF_FALSE;
		g_params.push_back( p );
	}

	// Instancia con OpenGL (tamaño inicial; luego se ajusta a lo que se pida).
	if( !ensureTarget( 640, 360, err ) ) return false;
	FFGLViewportStruct vp = { 0, 0, 640, 360 };
	lglBindFramebuffer( GL_FRAMEBUFFER, 0 );
	FFMixed inst = callP( FF_INSTANTIATE_GL, &vp );
	if( !inst.PointerValue || inst.PointerValue == (void*)(uintptr_t)FF_FAIL ) { err = "El plugin no pudo crear su instancia OpenGL (FF_INSTANTIATE_GL)"; return false; }
	g_inst = inst.PointerValue;
	SetHostinfoStruct hi = { "LumaMap", HOST_VERSION };
	if( isV2() ) callP( FF_SET_HOSTINFO, &hi, g_inst );
	// Valores actuales (los que puso la instancia).
	for( Param& p : g_params )
	{
		if( isText( p.type ) ) continue;
		FFMixed v = callU( FF_GET_PARAMETER, p.index, g_inst );
		if( v.UIntValue != FF_FAIL ) p.value = asFloat( v );
	}
	while( lglGetError() != GL_NO_ERROR ) {}
	return true;
}

static bool setFloat( uint32_t idx, float v, std::string& err )
{
	if( idx >= g_params.size() ) { err = "Parámetro inexistente"; return false; }
	Param& p = g_params[ idx ];
	if( isText( p.type ) ) { err = "Ese parámetro es de texto"; return false; }
	if( !std::isfinite( v ) ) v = p.def;
	SetParameterStruct s;
	s.ParameterNumber                = idx;
	s.NewParameterValue.PointerValue = NULL;
	memcpy( &s.NewParameterValue.UIntValue, &v, 4 );
	if( callP( FF_SET_PARAMETER, &s, g_inst ).UIntValue == FF_FAIL ) { err = "El plugin no aceptó el valor"; return false; }
	p.value = v;
	return true;
}
static bool setText( uint32_t idx, const std::string& t, std::string& err )
{
	if( idx >= g_params.size() ) { err = "Parámetro inexistente"; return false; }
	Param& p = g_params[ idx ];
	if( !isText( p.type ) ) { err = "Ese parámetro no es de texto"; return false; }
	p.text = t;   // se guarda aquí: el puntero sigue valiendo aunque el plugin no copie el texto
	SetParameterStruct s;
	s.ParameterNumber                = idx;
	s.NewParameterValue.PointerValue = (void*)p.text.c_str();
	if( callP( FF_SET_PARAMETER, &s, g_inst ).UIntValue == FF_FAIL ) { err = "El plugin no aceptó el texto"; return false; }
	return true;
}

static bool render( const unsigned char* msg, uint32_t len, std::string& err )
{
	if( len < 28 ) { err = "Petición de dibujo incompleta"; return false; }
	uint32_t w = get32( msg ), h = get32( msg + 4 );
	double time  = getF64( msg + 8 );
	float bpm    = getF32( msg + 16 );
	float phase  = getF32( msg + 20 );
	uint32_t inN = get32( msg + 24 );
	if( w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE ) { err = "Tamaño de imagen no válido"; return false; }
	const size_t bytes = (size_t)w * h * 4;
	if( inN != 0 && ( inN != bytes || len - 28 != inN ) ) { err = "La imagen de entrada no coincide con el tamaño pedido"; return false; }
	if( inN == 0 && len != 28 ) { err = "Petición de dibujo mal formada"; return false; }

	bool resized = w != g_w || h != g_h;
	if( !ensureTarget( w, h, err ) ) return false;
	if( resized )
	{
		FFGLViewportStruct vp = { 0, 0, w, h };
		callP( FF_RESIZE, &vp, g_inst );
	}

	// Entrada de los efectos: la imagen recibida (o negro si no hay). OpenGL tiene la fila 0 abajo.
	FFGLTextureStruct inTex;
	FFGLTextureStruct* inList[ 1 ] = { &inTex };
	const bool effect              = g_info.PluginType == FF_EFFECT;
	if( effect )
	{
		if( !g_inTex )
		{
			lglGenTextures( 1, &g_inTex );
			lglBindTexture( GL_TEXTURE_2D, g_inTex );
			lglTexParameteri( GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR );
			lglTexParameteri( GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR );
			lglTexParameteri( GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE );
			lglTexParameteri( GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE );
		}
		lglBindTexture( GL_TEXTURE_2D, g_inTex );
		lglPixelStorei( GL_UNPACK_ALIGNMENT, 1 );
		if( inN )
		{
			g_tmp.resize( bytes );
			const size_t row = (size_t)w * 4;
			for( uint32_t y = 0; y < h; y++ ) memcpy( &g_tmp[ ( h - 1 - y ) * row ], msg + 28 + y * row, row );
		}
		else g_tmp.assign( bytes, 0 );
		if( w != g_inW || h != g_inH )
		{
			lglTexImage2D( GL_TEXTURE_2D, 0, GL_RGBA8, (GLsizei)w, (GLsizei)h, 0, GL_RGBA, GL_UNSIGNED_BYTE, g_tmp.data() );
			g_inW = w;
			g_inH = h;
		}
		else lglTexSubImage2D( GL_TEXTURE_2D, 0, 0, 0, (GLsizei)w, (GLsizei)h, GL_RGBA, GL_UNSIGNED_BYTE, g_tmp.data() );
		lglBindTexture( GL_TEXTURE_2D, 0 );
		inTex.Width = inTex.HardwareWidth = w;
		inTex.Height = inTex.HardwareHeight = h;
		inTex.Handle                        = g_inTex;
	}

	if( std::isfinite( time ) ) callP( FF_SET_TIME, &time, g_inst );
	if( isV2() && std::isfinite( bpm ) && std::isfinite( phase ) )
	{
		SetBeatinfoStruct bi = { bpm, phase };
		callP( FF_SET_BEATINFO, &bi, g_inst );
	}

	// Estado por defecto que FFGL espera: FBO del anfitrión activo, sin programa ni texturas.
	lglBindFramebuffer( GL_FRAMEBUFFER, g_fbo );
	lglViewport( 0, 0, (GLsizei)w, (GLsizei)h );
	lglClearColor( 0, 0, 0, 0 );
	lglClear( GL_COLOR_BUFFER_BIT );
	lglActiveTexture( GL_TEXTURE0 );
	lglBindTexture( GL_TEXTURE_2D, 0 );
	lglUseProgram( 0 );
	ProcessOpenGLStruct pgl;
	pgl.numInputTextures = effect ? 1 : 0;
	pgl.inputTextures    = effect ? inList : NULL;
	pgl.HostFBO          = g_fbo;
	FFMixed r            = callP( FF_PROCESS_OPENGL, &pgl, g_inst );
	while( lglGetError() != GL_NO_ERROR ) {}
	if( r.UIntValue == FF_FAIL ) { err = "El plugin no pudo dibujar este fotograma"; return false; }

	// Leer el resultado y darle la vuelta (fila 0 = arriba, como un <canvas>).
	lglBindFramebuffer( GL_FRAMEBUFFER, g_fbo );
	lglPixelStorei( GL_PACK_ALIGNMENT, 1 );
	g_tmp.resize( bytes );
	lglReadPixels( 0, 0, (GLsizei)w, (GLsizei)h, GL_RGBA, GL_UNSIGNED_BYTE, g_tmp.data() );
	g_frame.resize( 8 + bytes );
	put32( &g_frame[ 0 ], w );
	put32( &g_frame[ 4 ], h );
	const size_t row = (size_t)w * 4;
	for( uint32_t y = 0; y < h; y++ ) memcpy( &g_frame[ 8 + y * row ], &g_tmp[ ( h - 1 - y ) * row ], row );
	return true;
}

static void shutdown()
{
	if( g_main )
	{
		if( g_inst ) callP( FF_DEINSTANTIATE_GL, NULL, g_inst );
		callU( FF_DEINITIALISE, 0 );
	}
	g_inst = NULL;
	destroyContext();
}

int main( int argc, char** argv )
{
	if( argc > 1 && !strcmp( argv[ 1 ], "--version" ) )
	{
		printf( "{\"host\":\"%s\",\"bits\":%d}\n", HOST_VERSION, (int)( sizeof( void* ) * 8 ) );
		return 0;
	}
	installCrashHandlers();
	// stdout es solo del protocolo: lo que impriman los plugins acaba en stderr.
#if defined( _WIN32 )
	_setmode( 0, _O_BINARY );
	g_out = _dup( 1 );
	_setmode( g_out, _O_BINARY );
	_dup2( 2, 1 );
	SetStdHandle( STD_OUTPUT_HANDLE, GetStdHandle( STD_ERROR_HANDLE ) );
#else
	g_out = dup( 1 );
	dup2( 2, 1 );
#endif
	if( g_out < 0 ) return 2;

	std::vector< unsigned char > msg;
	bool opened = false;
	for( ;; )
	{
		unsigned char h[ 5 ];
		if( !readAll( h, 5 ) ) break;   // LumaMap cerró la tubería
		uint32_t len = get32( h + 1 );
		if( len > MAX_MSG ) { replyError( "Mensaje demasiado grande" ); break; }
		msg.resize( len );
		if( len && !readAll( msg.data(), len ) ) break;
		std::string err;
		char cmd = (char)h[ 0 ];
		if( cmd == 'Q' ) { reply( 'K', NULL, 0 ); break; }
		if( cmd == 'O' )
		{
			if( opened ) { replyError( "Ya hay un plugin abierto en este proceso" ); continue; }
			std::string path( msg.begin(), msg.end() );
			if( !openPlugin( path, err ) )
			{
				replyError( err );
				break;   // un proceso por plugin: si no se pudo abrir, se termina
			}
			opened = true;
			replyJson( infoJson() );
			continue;
		}
		if( !opened ) { replyError( "Primero hay que abrir un plugin" ); continue; }
		switch( cmd )
		{
		case 'I': replyJson( infoJson() ); break;
		case 'P':
			if( len != 8 ) replyError( "Petición mal formada" );
			else if( setFloat( get32( msg.data() ), getF32( msg.data() + 4 ), err ) ) reply( 'K', NULL, 0 );
			else replyError( err );
			break;
		case 'S':
			if( len < 4 ) replyError( "Petición mal formada" );
			else if( setText( get32( msg.data() ), std::string( msg.begin() + 4, msg.end() ), err ) ) reply( 'K', NULL, 0 );
			else replyError( err );
			break;
		case 'R':
			if( render( msg.data(), len, err ) ) reply( 'K', g_frame.data(), (uint32_t)g_frame.size() );
			else replyError( err );
			break;
		default: replyError( "Comando desconocido" ); break;
		}
	}
	shutdown();
	return 0;
}
