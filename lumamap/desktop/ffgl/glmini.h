// glmini.h — lo mínimo de OpenGL para el anfitrión FFGL y el plugin de prueba, sin
// cabeceras de desarrollo: tipos, constantes y punteros a funciones que se cargan al
// ejecutar (Windows: wglGetProcAddress + opengl32.dll; Linux: la función que se pase,
// p. ej. OSMesaGetProcAddress). Todo es «static»: cada módulo tiene su propia copia.
#ifndef LUMA_GLMINI_H
#define LUMA_GLMINI_H

#include <stddef.h>
#include <stdint.h>

#if defined( _WIN32 )
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#define LGLAPI __stdcall
#else
#define LGLAPI
#endif

typedef unsigned int GLenum;
typedef unsigned int GLuint;
typedef int GLint;
typedef int GLsizei;
typedef unsigned int GLbitfield;
typedef float GLfloat;
typedef double GLdouble;
typedef unsigned char GLubyte;
typedef unsigned char GLboolean;
typedef char GLchar;
typedef void GLvoid;

#define GL_NO_ERROR 0
#define GL_TRIANGLES 0x0004
#define GL_QUADS 0x0007
#define GL_DEPTH_TEST 0x0B71
#define GL_BLEND 0x0BE2
#define GL_CULL_FACE 0x0B44
#define GL_UNPACK_ALIGNMENT 0x0CF5
#define GL_PACK_ALIGNMENT 0x0D05
#define GL_TEXTURE_2D 0x0DE1
#define GL_UNSIGNED_BYTE 0x1401
#define GL_FLOAT 0x1406
#define GL_MODELVIEW 0x1700
#define GL_PROJECTION 0x1701
#define GL_RGBA 0x1908
#define GL_VENDOR 0x1F00
#define GL_RENDERER 0x1F01
#define GL_VERSION 0x1F02
#define GL_LINEAR 0x2601
#define GL_TEXTURE_MAG_FILTER 0x2800
#define GL_TEXTURE_MIN_FILTER 0x2801
#define GL_TEXTURE_WRAP_S 0x2802
#define GL_TEXTURE_WRAP_T 0x2803
#define GL_COLOR_BUFFER_BIT 0x00004000
#define GL_RGBA8 0x8058
#define GL_CLAMP_TO_EDGE 0x812F
#define GL_TEXTURE0 0x84C0
#define GL_FRAGMENT_SHADER 0x8B30
#define GL_VERTEX_SHADER 0x8B31
#define GL_COMPILE_STATUS 0x8B81
#define GL_LINK_STATUS 0x8B82
#define GL_SHADING_LANGUAGE_VERSION 0x8B8C
#define GL_FRAMEBUFFER_BINDING 0x8CA6
#define GL_FRAMEBUFFER_COMPLETE 0x8CD5
#define GL_COLOR_ATTACHMENT0 0x8CE0
#define GL_FRAMEBUFFER 0x8D40
#define GL_CONTEXT_PROFILE_MASK 0x9126
#define GL_CONTEXT_CORE_PROFILE_BIT 0x00000001

// X(tipo de retorno, nombre sin «gl», (parámetros))
#define LUMA_GL_FUNCS( X )                                                                                  \
	X( GLenum, GetError, ( void ) )                                                                         \
	X( const GLubyte*, GetString, ( GLenum ) )                                                              \
	X( void, GetIntegerv, ( GLenum, GLint* ) )                                                              \
	X( void, Enable, ( GLenum ) )                                                                           \
	X( void, Disable, ( GLenum ) )                                                                          \
	X( void, Viewport, ( GLint, GLint, GLsizei, GLsizei ) )                                                 \
	X( void, ClearColor, ( GLfloat, GLfloat, GLfloat, GLfloat ) )                                           \
	X( void, Clear, ( GLbitfield ) )                                                                        \
	X( void, Finish, ( void ) )                                                                             \
	X( void, PixelStorei, ( GLenum, GLint ) )                                                               \
	X( void, ReadPixels, ( GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, void* ) )                        \
	X( void, GenTextures, ( GLsizei, GLuint* ) )                                                            \
	X( void, DeleteTextures, ( GLsizei, const GLuint* ) )                                                   \
	X( void, BindTexture, ( GLenum, GLuint ) )                                                              \
	X( void, TexParameteri, ( GLenum, GLenum, GLint ) )                                                     \
	X( void, TexImage2D, ( GLenum, GLint, GLint, GLsizei, GLsizei, GLint, GLenum, GLenum, const void* ) )   \
	X( void, TexSubImage2D, ( GLenum, GLint, GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, const void* ) )\
	X( void, ActiveTexture, ( GLenum ) )                                                                    \
	X( void, GenFramebuffers, ( GLsizei, GLuint* ) )                                                        \
	X( void, DeleteFramebuffers, ( GLsizei, const GLuint* ) )                                               \
	X( void, BindFramebuffer, ( GLenum, GLuint ) )                                                          \
	X( void, FramebufferTexture2D, ( GLenum, GLenum, GLenum, GLuint, GLint ) )                              \
	X( GLenum, CheckFramebufferStatus, ( GLenum ) )                                                         \
	X( GLuint, CreateShader, ( GLenum ) )                                                                   \
	X( void, ShaderSource, ( GLuint, GLsizei, const GLchar* const*, const GLint* ) )                       \
	X( void, CompileShader, ( GLuint ) )                                                                    \
	X( void, GetShaderiv, ( GLuint, GLenum, GLint* ) )                                                      \
	X( void, GetShaderInfoLog, ( GLuint, GLsizei, GLsizei*, GLchar* ) )                                     \
	X( void, DeleteShader, ( GLuint ) )                                                                     \
	X( GLuint, CreateProgram, ( void ) )                                                                    \
	X( void, AttachShader, ( GLuint, GLuint ) )                                                             \
	X( void, LinkProgram, ( GLuint ) )                                                                      \
	X( void, GetProgramiv, ( GLuint, GLenum, GLint* ) )                                                     \
	X( void, DeleteProgram, ( GLuint ) )                                                                    \
	X( void, UseProgram, ( GLuint ) )                                                                       \
	X( GLint, GetUniformLocation, ( GLuint, const GLchar* ) )                                               \
	X( void, Uniform1i, ( GLint, GLint ) )                                                                  \
	X( void, Uniform1f, ( GLint, GLfloat ) )                                                                \
	X( void, Uniform2f, ( GLint, GLfloat, GLfloat ) )                                                       \
	X( void, Uniform3f, ( GLint, GLfloat, GLfloat, GLfloat ) )                                              \
	X( void, GenVertexArrays, ( GLsizei, GLuint* ) )                                                        \
	X( void, DeleteVertexArrays, ( GLsizei, const GLuint* ) )                                               \
	X( void, BindVertexArray, ( GLuint ) )                                                                  \
	X( void, DrawArrays, ( GLenum, GLint, GLsizei ) )

// Funciones del OpenGL «clásico» (solo contexto de compatibilidad: plugins FFGL 1.x).
#define LUMA_GL_LEGACY_FUNCS( X )                                \
	X( void, MatrixMode, ( GLenum ) )                            \
	X( void, LoadIdentity, ( void ) )                            \
	X( void, Begin, ( GLenum ) )                                 \
	X( void, End, ( void ) )                                     \
	X( void, Color4f, ( GLfloat, GLfloat, GLfloat, GLfloat ) )   \
	X( void, Vertex2f, ( GLfloat, GLfloat ) )

#define LUMA_GL_DECL( ret, name, args )             \
	typedef ret( LGLAPI* PFN_lgl##name ) args;     \
	static PFN_lgl##name lgl##name = NULL;
LUMA_GL_FUNCS( LUMA_GL_DECL )
LUMA_GL_LEGACY_FUNCS( LUMA_GL_DECL )
#undef LUMA_GL_DECL

typedef void* ( *LumaGetProc )( const char* name );

// Busca una función de OpenGL. En Windows, wglGetProcAddress no da las de OpenGL 1.1:
// esas salen de opengl32.dll (la que ya está cargada en el proceso).
static void* lumaGlProc( LumaGetProc getProc, const char* name )
{
#if defined( _WIN32 )
	(void)getProc;
	void* p = (void*)wglGetProcAddress( name );
	if( p == NULL || p == (void*)1 || p == (void*)2 || p == (void*)3 || p == (void*)-1 )
	{
		HMODULE gl = GetModuleHandleA( "opengl32.dll" );
		p          = gl ? (void*)GetProcAddress( gl, name ) : NULL;
	}
	return p;
#else
	return getProc ? getProc( name ) : NULL;
#endif
}

// Carga todas las funciones. Devuelve el nombre de la primera que falte (o NULL si están todas).
static const char* lumaLoadGL( LumaGetProc getProc, int legacy )
{
	const char* missing = NULL;
#define LUMA_GL_LOAD( ret, name, args )                                         \
	lgl##name = (PFN_lgl##name)lumaGlProc( getProc, "gl" #name );               \
	if( !lgl##name && !missing ) missing = "gl" #name;
	LUMA_GL_FUNCS( LUMA_GL_LOAD )
	if( legacy )
	{
		LUMA_GL_LEGACY_FUNCS( LUMA_GL_LOAD )
	}
#undef LUMA_GL_LOAD
	return missing;
}

#endif
