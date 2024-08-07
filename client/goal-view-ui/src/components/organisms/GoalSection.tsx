import React, {FunctionComponent, ReactNode, useEffect, useRef, useState} from 'react';
import { VscPass } from 'react-icons/vsc';

import GoalCollapsibleSection from './GoalCollapsibles';
import GoalTabSection from './GoalTabs';
import EmptyState from '../atoms/EmptyState';
import { CollapsibleGoal } from '../../types';


type GoalSectionProps = {
    goals: CollapsibleGoal[],
    collapseGoalHandler: (id: string) => void, 
    displaySetting: string;
    emptyMessage: string;
    emptyIcon?: JSX.Element;
    maxDepth: number;
    helpMessageHandler: (message: string) => void;
};

const goalSection: FunctionComponent<GoalSectionProps> = (props) => {
    
    const {goals, collapseGoalHandler, displaySetting, emptyMessage, emptyIcon, maxDepth, helpMessageHandler} = props;
    const emptyMessageRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if(emptyMessageRef.current) {
            emptyMessageRef.current.scrollIntoView({
                behavior: "smooth",
                block: "end",
                inline: "nearest"
            });
        }
    }, [goals]);

    //This case should not happen
    if (goals === null) {
        return null;
    }

    const section = goals.length === 0 ?
        <>
            <EmptyState message={emptyMessage} icon={emptyIcon} />
            <div ref={emptyMessageRef}/>
        </>
    : displaySetting === 'Tabs' ?
        <GoalTabSection goals={goals} maxDepth={maxDepth} helpMessageHandler={helpMessageHandler}/>
        : <GoalCollapsibleSection goals={goals} collapseGoalHandler={collapseGoalHandler} maxDepth={maxDepth} helpMessageHandler={helpMessageHandler}/>;

    return section;
};

export default goalSection;