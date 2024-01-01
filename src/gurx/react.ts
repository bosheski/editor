import React, { useEffect } from 'react'
import { always, tap } from '../utils/fp'
import { RealmNode } from './realm'

import {
  TypedRealm,
  System,
  RealmFactory,
  ValueForKey,
  SystemKeys,
  SystemDict,
  AnySystemSpec,
  SystemOfSpecs,
  realmFactory,
  LongTuple
} from './realmFactory'

/** @internal */
interface Dict<T> {
  [key: string]: T
}

/** @internal */
function omit<O extends Dict<unknown>, K extends readonly (keyof O)[]>(keys: K, obj: O) {
  const result = {} as Omit<O, K[number]>
  const index = {} as Record<K[number], 1>
  let idx = 0
  const len = keys.length

  while (idx < len) {
    index[keys[idx]] = 1
    idx += 1
  }

  for (const prop in obj) {
    if (!Object.prototype.hasOwnProperty.call(index, prop)) {
      // @ts-expect-error one day I will solve that
      result[prop] = obj[prop]
    }
  }

  return result
}

const useIsomorphicLayoutEffect = typeof document !== 'undefined' ? React.useLayoutEffect : React.useEffect

/**
 * Describes the mapping between the system streams and the component properties.
 * Each property uses the keys as the names of the properties and the values as the corresponding stream names.
 * @typeParam SS - the type of the system.
 */
export interface SystemPropsMap<Sys extends System, K = keyof Sys, D = { [name: string]: K }> {
  /**
   * Specifies the required component properties.
   */
  required?: D
  /**
   * Specifies the optional component properties.
   */
  optional?: D
  /**
   * Specifies the component methods, if any. Streams are converted to methods with a single argument.
   * When invoked, the method publishes the value of the argument to the specified stream.
   */
  methods?: D
  /**
   * Specifies the component "event" properties, if any.
   * Event properties accept callback functions which get executed when the stream emits a new value.
   */
  events?: D
}

type StringKeys<T> = Extract<keyof T, string>

/** @internal */
export type PropsFromPropMap<Sys extends System, Map extends SystemPropsMap<Sys>> = {
  [K in StringKeys<Map['required']>]: Map['required'][K] extends string
  ? Sys[Map['required'][K]] extends RealmNode<infer R>
  ? R
  : never
  : never
} & {
    [K in StringKeys<Map['optional']>]?: Map['optional'][K] extends string
    ? Sys[Map['optional'][K]] extends RealmNode<infer R>
    ? R
    : never
    : never
  } & {
    [K in StringKeys<Map['events']>]?: Map['events'][K] extends string
    ? Sys[Map['events'][K]] extends RealmNode<infer R>
    ? (value: R) => void
    : never
    : never
  }

/** @internal */
export type MethodsFromPropMap<Sys extends System, Map extends SystemPropsMap<Sys>> = {
  [K in StringKeys<Map['methods']>]: Map['methods'][K] extends string
  ? Sys[Map['methods'][K]] extends RealmNode<infer R>
  ? (value: R) => void
  : never
  : never
}

/**
 * @internal
 * Used to correctly specify type refs for system components.
 *
 * @example
 * ```tsx
 * const s = system(() => { return { a: statefulStream(0) } })
 * const { Component } = systemToComponent(s)
 *
 * const App = () => {
 *  const ref = useRef<RefHandle<typeof Component>>()
 *  return <Component ref={ref} />
 * }
 * ```
 *
 * @typeParam T - the type of the component
 */
export type RefHandle<T> = T extends React.ForwardRefExoticComponent<React.RefAttributes<infer Handle>> ? Handle : never

const GurxContext = React.createContext(undefined)

/**
 * Converts a system spec to React component by mapping the system streams to component properties, events and methods. Returns hooks for querying and modifying
 * the system streams from the component's child components.
 * @param realmFactory - The return value from a [[system]] call.
 * @param map - The streams to props / events / methods mapping Check [[SystemPropsMap]] for more details.
 * @param Root - The optional React component to render. By default, the resulting component renders nothing, acting as a logical wrapper for its children.
 * @returns an object containing the following:
 *  - `Component`: the React component.
 *  - `useEmitterValue`: a hook that lets child components use values emitted from the specified output stream.
 *  - `useEmitter`: a hook that calls the provided callback whenever the specified stream emits a value.
 *  - `usePublisher`: a hook which lets child components publish values to the specified stream.
 *  <hr />
 */
export function realmFactoryToComponent<
  RootComp,
  // eslint-disable-next-line no-use-before-define
  RF extends RealmFactory<Sys>,
  Sys extends System = RF extends RealmFactory<infer S> ? S : never,
  Realm extends TypedRealm<Sys> = TypedRealm<Sys>,
  M extends SystemPropsMap<Sys> = SystemPropsMap<Sys>
>(realmFactory: RF, map: M, Root?: RootComp) {
  type RootCompProps = RootComp extends React.ComponentType<infer RP> ? RP : { children?: React.ReactNode }
  type CompProps = PropsFromPropMap<Sys, M> & RootCompProps
  type CompMethods = MethodsFromPropMap<Sys, M>

  const requiredPropNames = Object.keys(map.required || {}) as StringKeys<M['required']>[]
  const optionalPropNames = Object.keys(map.optional || {}) as StringKeys<M['optional']>[]
  const methodNames = Object.keys(map.methods || {}) as (keyof CompMethods)[]
  const eventNames = Object.keys(map.events || {}) as StringKeys<M['events']>[]
  // this enables HMR in vite. Unless context is persistent, HMR breaks.
  const Context = GurxContext as unknown as React.Context<Realm | undefined>

  function applyPropsToRealm(realm: Realm, props: CompProps) {
    const toBePublished: SystemDict<Sys> = {}

    for (const requiredPropName of requiredPropNames) {
      const nodeName = map.required![requiredPropName]
      toBePublished[nodeName] = props[requiredPropName]
    }

    for (const optionalPropName of optionalPropNames) {
      const value = props[optionalPropName]
      if (value !== undefined) {
        const nodeName = map.optional![optionalPropName]
        toBePublished[nodeName] = value
      }
    }

    realm.pubKeys(toBePublished)
  }

  function buildMethods(realm: Realm) {
    return methodNames.reduce((acc, methodName) => {
      const nodeName = map.methods![methodName]
      // @ts-expect-error why?
      acc[methodName] = (value: ValueForKey<Sys, typeof nodeName>) => {
        realm.pubKey(nodeName, value)
      }
      return acc
    }, {} as CompMethods)
  }

  const Component = React.forwardRef<CompMethods, CompProps>((props, ref) => {
    const realm = React.useMemo(() => {
      return tap<Realm>(realmFactory() as Realm, (realm) => applyPropsToRealm(realm, props))
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useIsomorphicLayoutEffect(() => {
      applyPropsToRealm(realm, props)
      realm.resetSingletonSubs()
      for (const eventName of eventNames) {
        if (eventName in props) {
          realm.singletonSubKey(map.events![eventName]! as string, props[eventName])
        }
      }
      return () => {
        realm.resetSingletonSubs()
      }
    }, [props])

    React.useImperativeHandle(ref, always(buildMethods(realm)))

    const children = (props as unknown as { children?: React.ReactNode }).children

    return React.createElement(
      Context.Provider,
      { value: realm },
      Root
        ? React.createElement(
          Root as unknown as React.ComponentType,
          omit([...requiredPropNames, ...optionalPropNames, ...eventNames], props),
          children
        )
        : children
    )
  })

  Component.displayName = 'Gurx Component'

  return {
    Component,
    ...sysHooks<Sys>()
  }
}

/** @internal */
export function sysHooks<Sys extends System>() {
  // this enables HMR in vite. Unless context is persistent, HMR breaks.
  const Context = GurxContext as unknown as React.Context<TypedRealm<Sys> | undefined>

  const usePublisher = <K extends keyof Sys>(key: K) => {
    const realm = React.useContext(Context)!
    return React.useCallback(
      (value: ValueForKey<Sys, K>) => {
        realm.pubKey(key, value)
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [key, realm]
    )
  }

  /**
   * Returns the values emitted from the nodes.
   */
  const useEmitterValues = <K extends SystemKeys<Sys>>(...keys: K) => {
    const realm = React.useContext(Context)!
    const [values, setValues] = React.useState(() => realm.getKeyValues(keys))

    useEffect(
      () =>
        realm?.subKeys(keys, (newValues) => {
          const setter = () => {
            if (keys.length === 1) {
              // @ts-expect-error the duality should be fixed with correct subscription mode
              newValues = [newValues]
            }

            for (let i = 0; i < keys.length; i++) {
              if (newValues[i] !== values[i]) {
                setValues(newValues)
              }
            }
            // this fixes the dual behavior in sub where subSingle and subMultiple fight
            // console.log('setting values', keys.length === 1 ? [newValues] : newValues)
            // setTimeout(() => {})
          }

          setter()
        }),
      [keys, realm, values]
    )

    return values
  }

  const usePubKeys = () => {
    return React.useContext(Context)!.pubKeys
  }

  const useEmitter = <K extends StringKeys<Sys>>(key: K, callback: (value: ValueForKey<Sys, K>) => void) => {
    const realm = React.useContext(Context)!
    useIsomorphicLayoutEffect(() => realm.subKey(key, callback), [callback])
  }

  const useRealmContext = () => {
    return React.useContext(Context)!
  }

  return {
    useRealmContext,
    useEmitter,
    useEmitterValues,
    usePubKeys,
    usePublisher
  }
}

type SystemAndDependencies<Spec extends AnySystemSpec> = SystemOfSpecs<[Spec]> & SystemOfSpecs<Spec['dependencies']>

const UsedPluginsContext = React.createContext<Set<string>>(new Set())

/**
 * The parameters of a plugin declaration. THe best way to understand what each one does is to examine the source code of the existing plugins.
 */
export interface RealmPluginParams<Spec extends AnySystemSpec, Params extends object> {
  /**
   * The id of the plugin. Used to declare conditional features that are activated only if the plugin is present.
   */
  id: string
  /**
   * The ids of the plugins that this plugin depends on. The plugin will not be activated if any of the dependencies is not present.
   */
  dependencies?: string[]
  /**
   * The system spec of the plugin. Construct one using {@link system}.
   */
  systemSpec: Spec
  /**
   * The callback is executed every time the react component is re-rendered.
   */
  applyParamsToSystem?: (realm: TypedRealm<SystemAndDependencies<Spec>>, props: Params) => void
  /**
   * Executed when the component mounts. Use this to register import/export visitors, add lexical nodes to the editor, etc.
   * @param realm - the realm instance
   * @param params - the parameters passed to the plugin in the component declaration
   * @param pluginIds - the ids of all the plugins that are present in the component declaration
   */
  init?: (realm: TypedRealm<SystemAndDependencies<Spec>>, params: Params, pluginIds: string[]) => void
}

/** @internal */
export interface PluginConstructor<Spec extends AnySystemSpec, Params extends object> {
  (params?: Params): { pluginParams?: Params } & RealmPluginParams<Spec, Params>
}

/**
 * Declares a new MDXEditor plugin.
 */
export function realmPlugin<Spec extends AnySystemSpec, Params extends object>(params: RealmPluginParams<Spec, Params>) {
  const plugin: PluginConstructor<Spec, Params> = (pluginParams?: Params) => {
    return {
      systemSpec: params.systemSpec,
      pluginParams,
      applyParamsToSystem: params.applyParamsToSystem,
      init: params.init,
      id: params.id,
      dependencies: params.dependencies
    }
  }

  return [plugin, sysHooks<SystemAndDependencies<Spec>>()] as const
}

/** @internal */
export const RealmPluginInitializer = function <P extends Array<ReturnType<PluginConstructor<AnySystemSpec, any>>>>({
  plugins,
  children
}: {
  plugins: P
  children?: React.ReactNode
}) {
  const validPlugins = React.useMemo(() => {
    const availablePlugins = plugins.map((plugin) => plugin.id)
    const validPlugins: P = plugins.filter((plugin) => {
      console.log('checking plugin', plugin.id)
      if (plugin.dependencies) {
        if (plugin.dependencies.some((dep) => !availablePlugins.includes(dep))) {
          console.warn('MDXEditor plugin', plugin.id, 'has some missing dependencies', plugin.dependencies, ', skipping')
          return false
        }
      }
      return true
    }) as P

    return validPlugins
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins])

  const realm = React.useMemo(() => {
    const specs = validPlugins.map((plugin) => plugin.systemSpec) as LongTuple<AnySystemSpec>
    const pluginIds = validPlugins.map((plugin) => plugin.id)
    const realm = realmFactory(...specs)
    validPlugins.forEach((plugin) => {
      plugin.init?.(realm, plugin.pluginParams, pluginIds)
      plugin.applyParamsToSystem?.(realm, plugin.pluginParams)
    })
    return realm
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    validPlugins.forEach((plugin) => {
      plugin.applyParamsToSystem?.(realm, plugin.pluginParams)
    })
  }, [realm, validPlugins])

  const Context = GurxContext as unknown as React.Context<TypedRealm<any>>

  return React.createElement(
    Context.Provider,
    { value: realm },
    React.createElement(UsedPluginsContext.Provider, { value: new Set(plugins.map((plugin) => plugin.id)) }, children)
  )
}

/** @internal */
export function useHasPlugin(id: string) {
  const usedPlugins = React.useContext(UsedPluginsContext)
  return usedPlugins.has(id)
}

/** @internal */
export const RequirePlugin: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  return useHasPlugin(id) ? React.createElement(React.Fragment, {}, children) : null
}
