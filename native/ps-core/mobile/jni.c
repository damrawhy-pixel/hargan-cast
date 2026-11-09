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
static jmethodID on_feedback;

JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *reserved)
{
	java_vm = vm;
	return JNI_VERSION_1_6;
}

// The core calls back from its own threads, which Java has not seen yet.
static JNIEnv *java_env(bool *attached)
{
	JNIEnv *env;
	*attached = false;
	if((*java_vm)->GetEnv(java_vm, (void **)&env, JNI_VERSION_1_6) == JNI_OK)
		return env;
	if((*java_vm)->AttachCurrentThread(java_vm, &env, NULL) != JNI_OK)
		return NULL;
	*attached = true;
	return env;
}

static void java_done(JNIEnv *env, bool attached)
{
	if((*env)->ExceptionCheck(env))
		(*env)->ExceptionClear(env);
	if(attached)
		(*java_vm)->DetachCurrentThread(java_vm);
}

static jbyteArray bytes(JNIEnv *env, const void *data, size_t size)
{
	jbyteArray array = (*env)->NewByteArray(env, (jsize)size);
	if(array && size)
		(*env)->SetByteArrayRegion(env, array, 0, (jsize)size, (const jbyte *)data);
	return array;
}

static void emit_to_java(const char *line, size_t size, void *user)
{
	bool attached;
	JNIEnv *env = java_env(&attached);
	if(!env)
		return;
	jbyteArray array = bytes(env, line, size);
	if(array)
	{
		(*env)->CallStaticVoidMethod(env, core_class, on_line, array);
		(*env)->DeleteLocalRef(env, array);
	}
	java_done(env, attached);
}

static void feedback_to_java(int kind, const unsigned char *data, size_t size, void *user)
{
	bool attached;
	JNIEnv *env = java_env(&attached);
	if(!env)
		return;
	jbyteArray array = bytes(env, data, size);
	if(array)
	{
		(*env)->CallStaticVoidMethod(env, core_class, on_feedback, (jint)kind, array);
		(*env)->DeleteLocalRef(env, array);
	}
	java_done(env, attached);
}

// Returns "port token", or null when the core could not start.
JNIEXPORT jstring JNICALL Java_app_hargan_ps_PsCore_start(JNIEnv *env, jclass cls, jstring cache_dir, jstring ca_bundle)
{
	if(!core_class)
	{
		core_class = (*env)->NewGlobalRef(env, cls);
		on_line = (*env)->GetStaticMethodID(env, cls, "onLine", "([B)V");
		on_feedback = (*env)->GetStaticMethodID(env, cls, "onFeedback", "(I[B)V");
		if(!on_line || !on_feedback)
			return NULL;
	}
	const char *cache = cache_dir ? (*env)->GetStringUTFChars(env, cache_dir, NULL) : NULL;
	const char *bundle = ca_bundle ? (*env)->GetStringUTFChars(env, ca_bundle, NULL) : NULL;
	int port = 0;
	char token[33];
	bool ok = hc_core_start(emit_to_java, NULL, cache, bundle, &port, token, sizeof(token));
	if(ok)
		hc_core_set_feedback(feedback_to_java, NULL);
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

JNIEXPORT void JNICALL Java_app_hargan_ps_PsCore_motion(JNIEnv *env, jclass cls,
	jfloat gyro_x, jfloat gyro_y, jfloat gyro_z, jfloat accel_x, jfloat accel_y, jfloat accel_z, jlong timestamp_us)
{
	hc_core_motion(gyro_x, gyro_y, gyro_z, accel_x, accel_y, accel_z, (unsigned long long)timestamp_us);
}

JNIEXPORT void JNICALL Java_app_hargan_ps_PsCore_motionReset(JNIEnv *env, jclass cls)
{
	hc_core_motion_reset();
}
