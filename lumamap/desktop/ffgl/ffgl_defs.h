// ffgl_defs.h — definiciones mínimas de la API FreeFrame GL (FFGL 2.x y 1.6) para LumaMap.
// Solo códigos de función, tipos y estructuras: sin OpenGL ni windows.h (eso va en glmini.h).
// Extraído de FFGL.h del SDK oficial (https://github.com/resolume/ffgl), cuya licencia se
// conserva aquí:
//
// Copyright (c) 2018 www.freeframe.org
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without modification,
// are permitted provided that the following conditions are met:
//
//  * Redistributions of source code must retain the above copyright
//    notice, this list of conditions and the following disclaimer.
//  * Redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in
//    the documentation and/or other materials provided with the
//    distribution.
//  * Neither the name of FreeFrame nor the names of its
//    contributors may be used to endorse or promote products derived
//    from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
// IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
// INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
// BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
// OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
// OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
// OF THE POSSIBILITY OF SUCH DAMAGE.
#ifndef LUMA_FFGL_DEFS_H
#define LUMA_FFGL_DEFS_H

#include <stdint.h>

typedef uint16_t FFUInt16;
typedef uint32_t FFUInt32;
typedef uint64_t FFUInt64;
typedef unsigned int FFGLuint;   // = GLuint

// Códigos de función de plugMain
static const FFUInt32 FF_GET_INFO                    = 0;
static const FFUInt32 FF_INITIALISE                  = 1;    // FFGL 1.x (obsoleto en 2.x)
static const FFUInt32 FF_DEINITIALISE                = 2;
static const FFUInt32 FF_GET_NUM_PARAMETERS          = 4;
static const FFUInt32 FF_GET_PARAMETER_NAME          = 5;
static const FFUInt32 FF_GET_PARAMETER_DEFAULT       = 6;
static const FFUInt32 FF_GET_PARAMETER_DISPLAY       = 7;
static const FFUInt32 FF_SET_PARAMETER               = 8;
static const FFUInt32 FF_GET_PARAMETER               = 9;
static const FFUInt32 FF_GET_PLUGIN_CAPS             = 10;
static const FFUInt32 FF_GET_EXTENDED_INFO           = 13;
static const FFUInt32 FF_GET_PARAMETER_TYPE          = 15;
static const FFUInt32 FF_GET_INPUT_STATUS            = 16;
static const FFUInt32 FF_PROCESS_OPENGL              = 17;
static const FFUInt32 FF_INSTANTIATE_GL              = 18;
static const FFUInt32 FF_DEINSTANTIATE_GL            = 19;
static const FFUInt32 FF_SET_TIME                    = 20;
static const FFUInt32 FF_CONNECT                     = 21;
static const FFUInt32 FF_DISCONNECT                  = 22;
static const FFUInt32 FF_RESIZE                      = 23;
static const FFUInt32 FF_GET_NUM_PARAMETER_ELEMENTS  = 31;
static const FFUInt32 FF_GET_PARAMETER_USAGE         = 32;
static const FFUInt32 FF_GET_PLUGIN_SHORT_NAME       = 33;
static const FFUInt32 FF_INITIALISE_V2               = 34;
static const FFUInt32 FF_GET_PARAMETER_ELEMENT_NAME  = 35;
static const FFUInt32 FF_GET_PARAMETER_ELEMENT_VALUE = 36;
static const FFUInt32 FF_SET_BEATINFO                = 38;
static const FFUInt32 FF_SET_HOSTINFO                = 39;
static const FFUInt32 FF_GET_RANGE                   = 41;
static const FFUInt32 FF_GET_PRAMETER_VISIBILITY     = 45;   // (sic) así se llama en el SDK

static const FFUInt32 FF_SUCCESS = 0;
static const FFUInt32 FF_FAIL    = 0xFFFFFFFF;
static const FFUInt32 FF_TRUE    = 1;
static const FFUInt32 FF_FALSE   = 0;

// Tipos de plugin
static const FFUInt32 FF_EFFECT = 0;
static const FFUInt32 FF_SOURCE = 1;
static const FFUInt32 FF_MIXER  = 2;

// Capacidades
static const FFUInt32 FF_CAP_SET_TIME             = 5;
static const FFUInt32 FF_CAP_MINIMUM_INPUT_FRAMES = 10;
static const FFUInt32 FF_CAP_MAXIMUM_INPUT_FRAMES = 11;

// Tipos de parámetro
static const FFUInt32 FF_TYPE_BOOLEAN    = 0;
static const FFUInt32 FF_TYPE_EVENT      = 1;
static const FFUInt32 FF_TYPE_RED        = 2;
static const FFUInt32 FF_TYPE_GREEN      = 3;
static const FFUInt32 FF_TYPE_BLUE       = 4;
static const FFUInt32 FF_TYPE_XPOS       = 5;
static const FFUInt32 FF_TYPE_YPOS       = 6;
static const FFUInt32 FF_TYPE_STANDARD   = 10;
static const FFUInt32 FF_TYPE_OPTION     = 11;
static const FFUInt32 FF_TYPE_BUFFER     = 12;
static const FFUInt32 FF_TYPE_INTEGER    = 13;
static const FFUInt32 FF_TYPE_FILE       = 14;
static const FFUInt32 FF_TYPE_TEXT       = 100;
static const FFUInt32 FF_TYPE_HUE        = 200;
static const FFUInt32 FF_TYPE_SATURATION = 201;
static const FFUInt32 FF_TYPE_BRIGHTNESS = 202;
static const FFUInt32 FF_TYPE_ALPHA      = 203;

typedef union FFMixed {
	FFUInt32 UIntValue;
	void* PointerValue;
} FFMixed;

typedef void* FFInstanceID;

typedef struct PluginInfoStructTag {
	FFUInt32 APIMajorVersion;
	FFUInt32 APIMinorVersion;
	char PluginUniqueID[ 4 ];   // sin terminar en nulo
	char PluginName[ 16 ];      // sin terminar en nulo
	FFUInt32 PluginType;
} PluginInfoStruct;

typedef struct PluginExtendedInfoStructTag {
	FFUInt32 PluginMajorVersion;
	FFUInt32 PluginMinorVersion;
	const char* Description;
	const char* About;
	FFUInt32 FreeFrameExtendedDataSize;
	void* FreeFrameExtendedDataBlock;
} PluginExtendedInfoStruct;

typedef struct SetParameterStructTag {
	FFUInt32 ParameterNumber;
	FFMixed NewParameterValue;
} SetParameterStruct;

typedef struct SetBeatinfoStructTag {
	float bpm;
	float barPhase;
} SetBeatinfoStruct;

typedef struct SetHostinfoStructTag {
	const char* name;
	const char* version;
} SetHostinfoStruct;

typedef struct RangeStructTag { float min; float max; } RangeStruct;
typedef struct GetRangeStructTag { FFUInt32 parameterNumber; RangeStruct range; } GetRangeStruct;

typedef struct GetParameterElementNameStructTag { FFUInt32 ParameterNumber; FFUInt32 ElementNumber; } GetParameterElementNameStruct;
typedef struct GetParameterElementValueStructTag { FFUInt32 ParameterNumber; FFUInt32 ElementNumber; } GetParameterElementValueStruct;

typedef struct FFGLViewportStructTag { FFGLuint x, y, width, height; } FFGLViewportStruct;

typedef struct FFGLTextureStructTag {
	FFUInt32 Width, Height;
	FFUInt32 HardwareWidth, HardwareHeight;
	FFGLuint Handle;
} FFGLTextureStruct;

typedef struct ProcessOpenGLStructTag {
	FFUInt32 numInputTextures;
	FFGLTextureStruct** inputTextures;
	FFGLuint HostFBO;
} ProcessOpenGLStruct;

#if defined( _WIN32 )
typedef FFMixed( __stdcall* FF_Main_FuncPtr )( FFUInt32, FFMixed, FFInstanceID );
#define FFGL_EXPORT extern "C" __declspec( dllexport )
#define FFGL_CALL __stdcall
#else
typedef FFMixed ( *FF_Main_FuncPtr )( FFUInt32, FFMixed, FFInstanceID );
#define FFGL_EXPORT extern "C" __attribute__( ( visibility( "default" ) ) )
#define FFGL_CALL
#endif

#endif
