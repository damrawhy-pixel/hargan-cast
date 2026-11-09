// SPDX-License-Identifier: AGPL-3.0-only
//
// Android entry points for app.hargan.ps.PsCore. Messages cross as UTF-8 bytes,
// because JNI's own string encoding cannot carry every character a catalog holds.

#include "hargan_ps.h"

#include <jni.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static JavaVM *java_vm;
static jclass core_class;
static jmethodID on_line;

JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *reserved)
{
	java_vm = vm;
	return JNI_VERSION_1_6;
}

static void emit_to_java(const char *line, size_t size, void *user)
{
	JNIEnv *env;
	bool attached = false;
	if((*java_vm)->GetEnv(java_vm, (void **)&env, JNI_VERSION_1_6) != JNI_OK)
	{
		if((*java_vm)->AttachCurrentThread(java_vm, &env, NULL) != JNI_OK)
			return;
		attached = true;
	}
	jbyteArray bytes = (*env)->NewByteArray(env, (jsize)size);
	if(bytes)
	{
		(*env)->SetByteArrayRegion(env, bytes, 0, (jsize)size, (const jbyte *)line);
		(*env)->CallStaticVoidMethod(env, core_class, on_line, bytes);
		(*env)->DeleteLocalRef(env, bytes);
	}
	if((*env)->ExceptionCheck(env))
		(*env)->ExceptionClear(env);
	if(attached)
		(*java_vm)->DetachCurrentThread(java_vm);
}

// Returns "port token", or null when the core could not start.
JNIEXPORT jstring JNICALL Java_app_hargan_ps_PsCore_start(JNIEnv *env, jclass cls, jstring cache_dir, jstring ca_bundle)
{
	if(!core_class)
	{
		core_class = (*env)->NewGlobalRef(env, cls);
		on_line = (*env)->GetStaticMethodID(env, cls, "onLine", "([B)V");
		if(!on_line)
			return NULL;
	}
	const char *cache = cache_dir ? (*env)->GetStringUTFChars(env, cache_dir, NULL) : NULL;
	const char *bundle = ca_bundle ? (*env)->GetStringUTFChars(env, ca_bundle, NULL) : NULL;
	int port = 0;
	char token[33];
	bool ok = hc_core_start(emit_to_java, NULL, cache, bundle, &port, token, sizeof(token));
	if(cache)
		(*env)->ReleaseStringUTFChars(env, cache_dir, cache);
	if(bundle)
		(*env)->ReleaseStringUTFChars(env, ca_bundle, bundle);
	if(!ok)
		return NULL;
	char out[64];
	snprintf(out, sizeof(out), "%d %s", port, token);
	return (*env)->NewStringUTF(env, out);
}

JNIEXPORT void JNICALL Java_app_hargan_ps_PsCore_command(JNIEnv *env, jclass cls, jbyteArray line)
{
	jsize size = (*env)->GetArrayLength(env, line);
	char *text = malloc((size_t)size + 1);
	if(!text)
		return;
	(*env)->GetByteArrayRegion(env, line, 0, size, (jbyte *)text);
	text[size] = 0;
	hc_core_command(text);
	// Commands carry the account's session token.
	volatile char *p = text;
	for(jsize i = 0; i < size; i++)
		p[i] = 0;
	free(text);
}
